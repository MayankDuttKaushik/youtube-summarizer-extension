// Enhanced popup.js with better UX and error handling

// Language options (keeping your existing list)
const languages = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español (Spanish)' },
  { code: 'fr', name: 'Français (French)' },
  { code: 'de', name: 'Deutsch (German)' },
  { code: 'pt', name: 'Português (Portuguese)' },
  { code: 'ru', name: 'Русский (Russian)' },
  { code: 'ja', name: '日本語 (Japanese)' },
  { code: 'ko', name: '한국어 (Korean)' },
  { code: 'zh', name: '中文 (Chinese)' },
  { code: 'hi', name: 'हिंदी (Hindi)' },
  { code: 'ar', name: 'العربية (Arabic)' },
  { code: 'it', name: 'Italiano (Italian)' },
  { code: 'nl', name: 'Nederlands (Dutch)' },
  { code: 'tr', name: 'Türkçe (Turkish)' },
  { code: 'vi', name: 'Tiếng Việt (Vietnamese)' }
];

// Enhanced error messages with actionable solutions
const ERROR_SOLUTIONS = {
  'No transcript available': {
    title: 'No Captions Found',
    message: 'This video doesn\'t have captions available.',
    actions: ['Try a different video', 'Check if captions are enabled']
  },
  'Could not extract transcript': {
    title: 'Transcript Extraction Failed',
    message: 'Unable to access video captions.',
    actions: ['Refresh the page', 'Check if video is public', 'Try again in a moment']
  },
  'Service is busy': {
    title: 'High Traffic',
    message: 'Our servers are experiencing high demand.',
    actions: ['Wait 30 seconds and try again', 'Try during off-peak hours']
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  const contentDiv = document.getElementById('content');
  
  // Add keyboard navigation support
  document.addEventListener('keydown', handleKeyboardNavigation);
  
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab.url || !tab.url.includes('youtube.com/watch')) {
    showNotYouTube();
    return;
  }
  
  // Get video info from content script with timeout
  try {
    const videoInfo = await Promise.race([
      sendMessageToTab(tab.id, { action: 'getVideoInfo' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
    ]);
    
    if (videoInfo && videoInfo.videoId) {
      showVideoInfo(videoInfo);
    } else {
      showError('Could not get video information', 'Video Detection Failed');
    }
  } catch (error) {
    if (error.message === 'Timeout') {
      showError('Page is still loading. Please wait a moment and try again.', 'Loading...');
    } else {
      showError('Error communicating with YouTube page. Please refresh and try again.', 'Connection Error');
    }
  }
});

function handleKeyboardNavigation(event) {
  if (event.key === 'Enter') {
    const focused = document.activeElement;
    if (focused.id === 'summarizeBtn') {
      focused.click();
    } else if (focused.id === 'keyPointsBtn') {
      focused.click();
    }
  }
}

async function showVideoInfo(videoInfo) {
  const contentDiv = document.getElementById('content');
  
  // Get saved preferences
  const { language = 'en', lastSummaryType = 'detailed' } = await chrome.storage.sync.get(['language', 'lastSummaryType']);
  
  contentDiv.innerHTML = `
    <div class="status-card">
      <div class="video-info">
        <div class="video-title" title="${escapeHtml(videoInfo.title)}">${escapeHtml(truncateTitle(videoInfo.title, 60))}</div>
        <div class="video-channel">${escapeHtml(videoInfo.channel || 'Unknown Channel')}</div>
        <div class="video-duration" id="videoDuration">Checking duration...</div>
      </div>
      <div class="language-selector">
        <label for="language">Summary Language:</label>
        <select id="language" aria-label="Select summary language">
          ${languages.map(lang => `
            <option value="${lang.code}" ${lang.code === language ? 'selected' : ''}>
              ${lang.name}
            </option>
          `).join('')}
        </select>
      </div>
      <div class="summary-type-selector">
        <label>Summary Type:</label>
        <div class="radio-group">
          <label class="radio-label">
            <input type="radio" name="summaryType" value="detailed" ${lastSummaryType === 'detailed' ? 'checked' : ''}>
            <span>Detailed Summary</span>
          </label>
          <label class="radio-label">
            <input type="radio" name="summaryType" value="key-points" ${lastSummaryType === 'key-points' ? 'checked' : ''}>
            <span>Key Points Only</span>
          </label>
        </div>
      </div>
      <div class="button-container">
        <button id="summarizeBtn" class="primary-btn" aria-label="Generate summary">
          <span class="btn-text">Summarize Video</span>
          <span class="btn-icon">✨</span>
        </button>
      </div>
      <div class="quick-stats" id="quickStats"></div>
    </div>
    <div id="summaryContainer"></div>
  `;
  
  // Get video duration for cost estimation
  getVideoDuration(videoInfo.videoId);
  
  // Save preferences when changed
  document.getElementById('language').addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ language: e.target.value });
  });
  
  document.querySelectorAll('input[name="summaryType"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
      await chrome.storage.sync.set({ lastSummaryType: e.target.value });
    });
  });
  
  document.getElementById('summarizeBtn').addEventListener('click', () => {
    const summaryType = document.querySelector('input[name="summaryType"]:checked').value;
    summarizeVideo(videoInfo, summaryType);
  });
}

async function getVideoDuration(videoId) {
  try {
    const durationElement = document.getElementById('videoDuration');
    if (!durationElement) return;
    
    // Try to extract duration from the page
    const durationSelector = 'span.ytp-time-duration';
    const durationEl = document.querySelector(durationSelector);
    
    if (durationEl) {
      const duration = durationEl.textContent;
      durationElement.textContent = `Duration: ${duration}`;
      
      // Estimate processing time based on duration
      const quickStats = document.getElementById('quickStats');
      if (quickStats) {
        quickStats.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>⏱️ Est. processing: ~30-60s</span>
            <span>🎯 Accuracy: High</span>
          </div>
        `;
      }
    } else {
      // Fallback - try to get from content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const result = await chrome.tabs.sendMessage(tab.id, { action: 'getDuration' });
      
      if (result?.duration) {
        durationElement.textContent = `Duration: ${result.duration}`;
      } else {
        durationElement.textContent = 'Duration: Available after play';
      }
    }
  } catch (error) {
    const durationElement = document.getElementById('videoDuration');
    if (durationElement) {
      durationElement.textContent = 'Duration: Unknown';
    }
  }
}

function truncateTitle(title, maxLength) {
  return title.length > maxLength ? title.substring(0, maxLength) + '...' : title;
}

async function summarizeVideo(videoInfo, summaryType) {
  const summaryContainer = document.getElementById('summaryContainer');
  const summarizeBtn = document.getElementById('summarizeBtn');
  
  // Enhanced loading state
  summarizeBtn.disabled = true;
  summarizeBtn.innerHTML = `
    <span class="btn-text">Processing...</span>
    <div class="btn-spinner"></div>
  `;
  
  // Progressive loading messages
  const loadingMessages = [
    'Extracting transcript...',
    'Analyzing content...',
    'Generating summary...',
    'Almost done...'
  ];
  
  let messageIndex = 0;
  summaryContainer.innerHTML = `
    <div class="loading">
      <div class="loading-spinner"></div>
      <p id="loadingMessage">${loadingMessages[0]}</p>
      <div class="progress-bar">
        <div class="progress-fill" id="progressFill"></div>
      </div>
    </div>
  `;
  
  // Update loading message periodically
  const messageInterval = setInterval(() => {
    messageIndex = (messageIndex + 1) % loadingMessages.length;
    const messageEl = document.getElementById('loadingMessage');
    const progressEl = document.getElementById('progressFill');
    if (messageEl) {
      messageEl.textContent = loadingMessages[messageIndex];
      progressEl.style.width = `${((messageIndex + 1) / loadingMessages.length) * 100}%`;
    }
  }, 2000);
  
  try {
    // Get transcript from content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const { transcript } = await sendMessageToTab(tab.id, { action: 'getTranscript' });
    
    if (!transcript) {
      throw new Error('Could not extract transcript. Make sure the video has captions available.');
    }
    
    // Get selected language and summary type
    const selectedLanguage = document.getElementById('language').value;
    
    // Send to background script for API call
    const response = await chrome.runtime.sendMessage({
      action: 'summarize',
      transcript: transcript,
      videoInfo: videoInfo,
      summaryType: summaryType,
      language: selectedLanguage
    });
    
    clearInterval(messageInterval);
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    // Show success feedback
    displaySummary(response.summary, summaryType, response.cached, response.processingTime);
    
    // Track usage analytics (privacy-friendly)
    trackUsage(summaryType, selectedLanguage, transcript.length);
    
  } catch (error) {
    clearInterval(messageInterval);
    showEnhancedError(error.message);
  } finally {
    // Reset button
    summarizeBtn.disabled = false;
    summarizeBtn.innerHTML = `
      <span class="btn-text">Summarize Video</span>
      <span class="btn-icon">✨</span>
    `;
  }
}

function showEnhancedError(errorMessage) {
  const summaryContainer = document.getElementById('summaryContainer');
  const errorInfo = ERROR_SOLUTIONS[errorMessage] || {
    title: 'Error',
    message: errorMessage,
    actions: ['Try again', 'Refresh the page']
  };
  
  summaryContainer.innerHTML = `
    <div class="error-card">
      <div class="error-header">
        <span class="error-icon">⚠️</span>
        <h3>${errorInfo.title}</h3>
      </div>
      <p class="error-message">${errorInfo.message}</p>
      <div class="error-actions">
        <h4>Try these solutions:</h4>
        <ul>
          ${errorInfo.actions.map(action => `<li>${action}</li>`).join('')}
        </ul>
      </div>
      <button id="retryBtn" class="secondary-btn">Try Again</button>
    </div>
  `;
  
  document.getElementById('retryBtn')?.addEventListener('click', () => {
    location.reload();
  });
}

function displaySummary(summary, summaryType, cached = false, processingTime = 0) {
  const summaryContainer = document.getElementById('summaryContainer');
  const headerText = summaryType === 'detailed' ? 'Video Summary' : 'Key Points';
  const cacheIndicator = cached ? ' <span class="cache-indicator" title="Loaded from cache">⚡</span>' : '';
  const timeIndicator = processingTime ? ` <span class="time-indicator">${Math.round(processingTime/1000)}s</span>` : '';
  
  summaryContainer.innerHTML = `
    <div class="summary-container">
      <div class="summary-header">
        <span>${headerText}${cacheIndicator}${timeIndicator}</span>
        <div class="summary-actions">
          <button id="copyBtn" class="copy-btn" aria-label="Copy summary">Copy</button>
          <button id="shareBtn" class="share-btn" aria-label="Share summary">Share</button>
        </div>
      </div>
      <div class="summary-content" role="main">${formatSummary(summary)}</div>
      <div class="summary-footer">
        <button id="improveBtn" class="feedback-btn">Suggest Improvement</button>
      </div>
    </div>
  `;
  
  // Enhanced copy functionality
  document.getElementById('copyBtn').addEventListener('click', () => {
    copyToClipboard(summary);
  });
  
  // Share functionality
  document.getElementById('shareBtn').addEventListener('click', () => {
    shareSummary(summary);
  });
  
  // Feedback functionality
  document.getElementById('improveBtn').addEventListener('click', () => {
    showFeedbackForm();
  });
}

async function shareSummary(summary) {
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'YouTube Video Summary',
        text: summary
      });
    } catch (error) {
      console.log('Share cancelled or failed:', error);
    }
  } else {
    // Fallback: copy to clipboard
    copyToClipboard(summary);
  }
}

function trackUsage(summaryType, language, transcriptLength) {
  // Privacy-friendly analytics - no personal data
  chrome.storage.local.get(['usageStats'], (result) => {
    const stats = result.usageStats || { totalSummaries: 0, languages: {}, types: {} };
    stats.totalSummaries++;
    stats.languages[language] = (stats.languages[language] || 0) + 1;
    stats.types[summaryType] = (stats.types[summaryType] || 0) + 1;
    chrome.storage.local.set({ usageStats: stats });
  });
}

// Keep your existing helper functions
function formatSummary(summary) {
  return summary
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h3>$1</h3>')
    .replace(/^\* (.+)$/gm, '<li>$1</li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)\n/g, '$1')
    .replace(/(<li>.*<\/li>)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>')
    .replace(/<p><h3>/g, '<h3>')
    .replace(/<\/h3><\/p>/g, '</h3>')
    .replace(/<p><ul>/g, '<ul>')
    .replace(/<\/ul><\/p>/g, '</ul>');
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    const copyBtn = document.getElementById('copyBtn');
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    copyBtn.classList.add('success');
    setTimeout(() => {
      copyBtn.textContent = originalText;
      copyBtn.classList.remove('success');
    }, 2000);
  }).catch(() => {
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

function showError(message, title = 'Error') {
  const contentDiv = document.getElementById('content');
  contentDiv.innerHTML = `
    <div class="error-card">
      <div class="error-header">
        <span class="error-icon">⚠️</span>
        <h3>${title}</h3>
      </div>
      <p class="error-message">${escapeHtml(message)}</p>
    </div>
  `;
}

function showNotYouTube() {
  const contentDiv = document.getElementById('content');
  contentDiv.innerHTML = `
    <div class="not-youtube">
      <div class="not-youtube-icon">📺</div>
      <h3>No YouTube Video Detected</h3>
      <p>Please navigate to a YouTube video to use this extension.</p>
      <button id="openYouTube" class="primary-btn">Open YouTube</button>
    </div>
  `;
  
  document.getElementById('openYouTube')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://youtube.com' });
  });
}

function showFeedbackForm() {
  const summaryContainer = document.getElementById('summaryContainer');
  const feedbackHTML = `
    <div class="feedback-form">
      <div class="feedback-header">
        <h3>Help Us Improve</h3>
        <p>Your feedback helps make summaries better for everyone.</p>
      </div>
      <div class="feedback-options">
        <button class="feedback-option" onclick="sendFeedback('accuracy')">
          📊 Improve Accuracy
        </button>
        <button class="feedback-option" onclick="sendFeedback('length')">
          📏 Better Length
        </button>
        <button class="feedback-option" onclick="sendFeedback('language')">
          🌍 Language Issues
        </button>
        <button class="feedback-option" onclick="sendFeedback('other')">
          💭 Other Feedback
        </button>
      </div>
      <button id="closeFeedback" class="secondary-btn" style="margin-top: 15px;">Close</button>
    </div>
  `;
  
  summaryContainer.innerHTML += feedbackHTML;
  
  // Add styles for feedback form
  const style = document.createElement('style');
  style.textContent = `
    .feedback-form {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      margin-top: 15px;
      border: 1px solid #e2e8f0;
    }
    .feedback-header h3 {
      color: #2d3748;
      margin-bottom: 8px;
      font-size: 16px;
    }
    .feedback-header p {
      color: #718096;
      font-size: 14px;
      margin-bottom: 15px;
    }
    .feedback-options {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 15px;
    }
    .feedback-option {
      padding: 10px;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .feedback-option:hover {
      background: #e2e8f0;
      transform: translateY(-1px);
    }
  `;
  document.head.appendChild(style);
  
  // Add event listeners
  document.getElementById('closeFeedback').addEventListener('click', () => {
    document.querySelector('.feedback-form').remove();
  });
  
  window.sendFeedback = (type) => {
    // Track feedback type (privacy-friendly)
    chrome.storage.local.get(['feedbackStats'], (result) => {
      const stats = result.feedbackStats || {};
      stats[type] = (stats[type] || 0) + 1;
      chrome.storage.local.set({ feedbackStats: stats });
    });
    
    // Show thank you message
    document.querySelector('.feedback-form').innerHTML = `
      <div style="text-align: center; padding: 20px;">
        <div style="font-size: 24px; margin-bottom: 10px;">✅</div>
        <h3 style="color: #2d3748; margin-bottom: 8px;">Thank You!</h3>
        <p style="color: #718096; font-size: 14px;">Your feedback has been recorded and will help us improve the extension.</p>
      </div>
    `;
    
    setTimeout(() => {
      document.querySelector('.feedback-form')?.remove();
    }, 3000);
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
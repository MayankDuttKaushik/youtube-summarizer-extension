// Enhanced sidepanel.js - All popup functionality adapted for side panel
// Side Panel API provides persistent, tall interface for better UX

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
  },
  'HTTP 502': {
    title: 'Server Temporarily Down',
    message: 'The summarization service is temporarily unavailable.',
    actions: ['Wait a few minutes and try again', 'Check your internet connection']
  },
  'Failed to generate summary. Please try again.': {
    title: 'Generation Failed',
    message: 'This video cannot be summarized.',
    actions: ['Check if video has captions/subtitles', 'Try a different video with speech content', 'Avoid music videos or very short clips']
  },
  'Could not extract transcript. Make sure the video has captions available.': {
    title: 'No Transcript Available',
    message: 'This video has no captions or subtitles.',
    actions: ['Try videos with auto-generated captions', 'Look for videos with CC (closed captions)', 'Educational/talk videos usually work best']
  },
  'Video transcript too short to summarize. Try a longer video with more speech content.': {
    title: 'Video Too Short',
    message: 'This video has very little spoken content.',
    actions: ['Try videos longer than 2-3 minutes', 'Choose videos with continuous speech', 'Avoid music videos or silent content']
  }
};

// Global state for side panel
let currentTabId = null;
let currentVideoInfo = null;

// Initialize side panel when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Side panel loaded');
  
  // Add keyboard navigation support
  document.addEventListener('keydown', handleKeyboardNavigation);
  
  // Get current active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab.id;
    
    if (!tab.url || !tab.url.includes('youtube.com/watch')) {
      showNotYouTube();
      return;
    }
    
    // Listen for tab updates to refresh content when switching videos
    chrome.tabs.onUpdated.addListener(handleTabUpdate);
    chrome.tabs.onActivated.addListener(handleTabActivated);
    
    await loadVideoContent(tab);
    
  } catch (error) {
    console.error('Error initializing side panel:', error);
    showError('Error initializing side panel. Please refresh and try again.', 'Initialization Error');
  }
});

// Handle tab updates (new video navigation)
function handleTabUpdate(tabId, changeInfo, tab) {
  if (tabId === currentTabId && changeInfo.url && tab.url.includes('youtube.com/watch')) {
    console.log('🔄 Video URL changed:', changeInfo.url);
    console.log('🧹 Clearing all previous state...');
    
    // Force clear everything
    currentVideoInfo = null;
    const contentDiv = document.getElementById('content');
    const summaryContainer = document.getElementById('summaryContainer');
    
    if (contentDiv) contentDiv.innerHTML = '<div class="loading">Loading new video...</div>';
    if (summaryContainer) summaryContainer.innerHTML = '';
    
    // Small delay to ensure YouTube page has updated
    setTimeout(() => {
      loadVideoContent(tab);
    }, 500);
  }
}

// Handle tab activation (switching between tabs)
async function handleTabActivated(activeInfo) {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    currentTabId = tab.id;
    
    if (tab.url && tab.url.includes('youtube.com/watch')) {
      loadVideoContent(tab);
    } else {
      showNotYouTube();
    }
  } catch (error) {
    console.error('Error handling tab activation:', error);
  }
}

// Load video content for current tab
async function loadVideoContent(tab) {
  const contentDiv = document.getElementById('content');
  
  // Clear any existing summary when switching videos
  const summaryContainer = document.getElementById('summaryContainer');
  if (summaryContainer) {
    summaryContainer.innerHTML = '';
  }
  
  try {
    // Get video info from content script with timeout
    const videoInfo = await Promise.race([
      sendMessageToTab(tab.id, { action: 'getVideoInfo' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
    ]);
    
    if (videoInfo && videoInfo.videoId) {
      // Always update - don't trust the comparison
      console.log(`📺 Loading video: ${videoInfo.title} (${videoInfo.videoId})`);
      
      // Clear any existing summary immediately
      const summaryContainer = document.getElementById('summaryContainer');
      if (summaryContainer) {
        summaryContainer.innerHTML = '';
      }
      
      currentVideoInfo = videoInfo;
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
}

function handleKeyboardNavigation(event) {
  if (event.key === 'Enter') {
    const focused = document.activeElement;
    if (focused.id === 'summarizeBtn') {
      focused.click();
    }
  }
}

async function showVideoInfo(videoInfo) {
  const contentDiv = document.getElementById('content');
  
  console.log(`🎬 Updating UI for video: "${videoInfo.title}" (${videoInfo.videoId})`);
  
  // Get saved preferences with error handling
  let language = 'en';
  let lastSummaryType = 'detailed';
  
  try {
    const prefs = await chrome.storage.sync.get(['language', 'lastSummaryType']);
    language = prefs.language || 'en';
    lastSummaryType = prefs.lastSummaryType || 'detailed';
  } catch (error) {
    console.warn('Could not load preferences from storage:', error);
    // Use defaults
  }
  
  contentDiv.innerHTML = `
    <div class="status-card">
      <div class="video-info">
        <div class="video-title" title="${escapeHtml(videoInfo.title)}">${escapeHtml(videoInfo.title)}</div>
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
            <span>📋 Detailed Summary</span>
          </label>
          <label class="radio-label">
            <input type="radio" name="summaryType" value="key-points" ${lastSummaryType === 'key-points' ? 'checked' : ''}>
            <span>🎯 Key Points Only</span>
          </label>
        </div>
      </div>
      <div class="button-container">
        <button id="summarizeBtn" class="primary-btn" aria-label="Generate summary">
          <span class="btn-text">Summarize Video</span>
          <span class="btn-icon">✨</span>
        </button>
        <button id="refreshBtn" class="secondary-btn" aria-label="Refresh video info" style="margin-left: 8px; padding: 8px 12px; font-size: 12px;">
          🔄 Refresh
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
    try {
      await chrome.storage.sync.set({ language: e.target.value });
    } catch (error) {
      console.warn('Could not save language preference:', error);
    }
  });
  
  document.querySelectorAll('input[name="summaryType"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
      try {
        await chrome.storage.sync.set({ lastSummaryType: e.target.value });
      } catch (error) {
        console.warn('Could not save summary type preference:', error);
      }
    });
  });
  
  document.getElementById('summarizeBtn').addEventListener('click', () => {
    const summaryType = document.querySelector('input[name="summaryType"]:checked').value;
    summarizeVideo(videoInfo, summaryType);
  });
  
  // Add refresh button functionality
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    console.log('🔄 Manual refresh requested');
    
    // Clear everything
    currentVideoInfo = null;
    const summaryContainer = document.getElementById('summaryContainer');
    if (summaryContainer) summaryContainer.innerHTML = '';
    
    // Get current tab and force reload
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && tab.url.includes('youtube.com/watch')) {
        await loadVideoContent(tab);
      }
    } catch (error) {
      console.error('Error during manual refresh:', error);
    }
  });
}

async function getVideoDuration(videoId) {
  try {
    const durationElement = document.getElementById('videoDuration');
    if (!durationElement) return;
    
    // Try to extract duration from the page
    if (currentTabId) {
      const result = await sendMessageToTab(currentTabId, { action: 'getDuration' });
      
      if (result?.duration) {
        durationElement.textContent = `Duration: ${result.duration}`;
        
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
  console.log(`🎯 Starting summarization for: "${videoInfo.title}" (${videoInfo.videoId})`);
  console.log(`📊 Summary type: ${summaryType}`);
  
  const summaryContainer = document.getElementById('summaryContainer');
  const summarizeBtn = document.getElementById('summarizeBtn');
  
  // Verify we have the current video info
  if (!currentVideoInfo || currentVideoInfo.videoId !== videoInfo.videoId) {
    console.warn('⚠️ Video info mismatch detected, refreshing...');
    // Try to get fresh video info
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await loadVideoContent(tab);
      return; // Exit and let user try again with fresh data
    } catch (error) {
      console.error('Error refreshing video info:', error);
    }
  }
  
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
      <p id="loadingMessage" class="loading-message">${loadingMessages[0]}</p>
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
    if (!currentTabId) {
      throw new Error('No active tab available');
    }
    
    const { transcript } = await sendMessageToTab(currentTabId, { action: 'getTranscript' });
    
    if (!transcript) {
      throw new Error('Could not extract transcript. Make sure the video has captions available.');
    }
    
    if (transcript.length < 50) {
      throw new Error('Video transcript too short to summarize. Try a longer video with more speech content.');
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
    if (currentVideoInfo) {
      const summaryType = document.querySelector('input[name="summaryType"]:checked').value;
      summarizeVideo(currentVideoInfo, summaryType);
    }
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
      <p>Navigate to a YouTube video to use the summarizer. The side panel will automatically detect when you're watching a video.</p>
      <button id="openYouTube" class="primary-btn">Open YouTube</button>
    </div>
  `;
  
  document.getElementById('openYouTube')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://youtube.com' });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Side panel specific: Handle visibility changes
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentTabId) {
    // Side panel became visible, refresh content if needed
    chrome.tabs.get(currentTabId).then(tab => {
      if (tab.url && tab.url.includes('youtube.com/watch')) {
        // Only refresh if we don't have current video info or the URL changed
        if (!currentVideoInfo || !tab.url.includes(currentVideoInfo.videoId)) {
          loadVideoContent(tab);
        }
      }
    }).catch(console.error);
  }
});

// Handle messages from background script (if needed)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'videoChangedNotification') {
    console.log('🎬 Received video change notification:', message.videoId);
    // Background script notifies us of video changes
    loadVideoContent(message.tab);
  }
  
  if (message.action === 'tabActivated') {
    console.log('📱 Tab activation received:', message.tab?.url);
    // Handle tab activation from background script
    if (message.tab && message.tab.url && message.tab.url.includes('youtube.com/watch')) {
      loadVideoContent(message.tab);
    }
  }
});
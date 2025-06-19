document.addEventListener('DOMContentLoaded', async () => {
  const contentDiv = document.getElementById('content');
  
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab.url || !tab.url.includes('youtube.com/watch')) {
    showNotYouTube();
    return;
  }
  
  // Get video info from content script
  try {
    const videoInfo = await sendMessageToTab(tab.id, { action: 'getVideoInfo' });
    if (videoInfo && videoInfo.videoId) {
      showVideoInfo(videoInfo);
    } else {
      showError('Could not get video information');
    }
  } catch (error) {
    showError('Error communicating with YouTube page. Please refresh and try again.');
  }
});

function showNotYouTube() {
  const contentDiv = document.getElementById('content');
  contentDiv.innerHTML = `
    <div class="not-youtube">
      <div class="not-youtube-icon">📺</div>
      <h3>No YouTube Video Detected</h3>
      <p>Please navigate to a YouTube video to use this extension.</p>
    </div>
  `;
}

function showVideoInfo(videoInfo) {
  const contentDiv = document.getElementById('content');
  contentDiv.innerHTML = `
    <div class="status-card">
      <div class="video-info">
        <div class="video-title">${escapeHtml(videoInfo.title)}</div>
        <div class="video-channel">${escapeHtml(videoInfo.channel || 'Unknown Channel')}</div>
      </div>
      <div class="button-container">
        <button id="summarizeBtn" class="primary-btn">Summarize Video</button>
        <button id="keyPointsBtn" class="secondary-btn">Key Points Only</button>
      </div>
    </div>
    <div id="summaryContainer"></div>
  `;
  
  document.getElementById('summarizeBtn').addEventListener('click', () => {
    summarizeVideo(videoInfo, 'detailed');
  });
  
  document.getElementById('keyPointsBtn').addEventListener('click', () => {
    summarizeVideo(videoInfo, 'key-points');
  });
}

async function summarizeVideo(videoInfo, summaryType) {
  const summaryContainer = document.getElementById('summaryContainer');
  const summarizeBtn = document.getElementById('summarizeBtn');
  const keyPointsBtn = document.getElementById('keyPointsBtn');
  
  // Disable buttons
  summarizeBtn.disabled = true;
  keyPointsBtn.disabled = true;
  
  // Show loading
  summaryContainer.innerHTML = `
    <div class="loading">
      <div class="loading-spinner"></div>
      <p>Extracting transcript...</p>
    </div>
  `;
  
  try {
    // Get transcript from content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const { transcript } = await sendMessageToTab(tab.id, { action: 'getTranscript' });
    
    if (!transcript) {
      throw new Error('Could not extract transcript. Make sure the video has captions available.');
    }
    
    // Update loading message
    summaryContainer.querySelector('.loading p').textContent = 'Generating summary...';
    
    // Send to background script for API call
    const response = await chrome.runtime.sendMessage({
      action: 'summarize',
      transcript: transcript,
      videoInfo: videoInfo,
      summaryType: summaryType
    });
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    // Display summary
    displaySummary(response.summary, summaryType);
    
  } catch (error) {
    summaryContainer.innerHTML = `
      <div class="error">
        <strong>Error:</strong> ${escapeHtml(error.message)}
      </div>
    `;
  } finally {
    // Re-enable buttons
    summarizeBtn.disabled = false;
    keyPointsBtn.disabled = false;
  }
}

function displaySummary(summary, summaryType) {
  const summaryContainer = document.getElementById('summaryContainer');
  const headerText = summaryType === 'detailed' ? 'Video Summary' : 'Key Points';
  
  summaryContainer.innerHTML = `
    <div class="summary-container">
      <div class="summary-header">
        <span>${headerText}</span>
        <button id="copyBtn" class="copy-btn">Copy</button>
      </div>
      <div class="summary-content">${formatSummary(summary)}</div>
    </div>
  `;
  
  document.getElementById('copyBtn').addEventListener('click', () => {
    copyToClipboard(summary);
  });
}

function formatSummary(summary) {
  // Convert markdown-style formatting to HTML
  return summary
    // Handle bold text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Handle italic text
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Handle headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h3>$1</h3>')
    // Handle bullet points
    .replace(/^\* (.+)$/gm, '<li>$1</li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Group list items
    .replace(/(<li>.*<\/li>)\n/g, '$1')
    .replace(/(<li>.*<\/li>)+/g, '<ul>$&</ul>')
    // Handle paragraphs
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>')
    // Clean up edge cases
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
    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 2000);
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

function showError(message) {
  const contentDiv = document.getElementById('content');
  contentDiv.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
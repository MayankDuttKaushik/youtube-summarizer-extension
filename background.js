// Enhanced background.js with side panel integration and caching

const API_BASE_URL = 'https://youtube-summarizer-api-production.up.railway.app';

// In-memory cache for summaries (consider chrome.storage.local for persistence)
const summaryCache = new Map();

// Generate cache key from video info and settings
function generateCacheKey(videoId, summaryType, language) {
  return `${videoId}_${summaryType}_${language}`;
}

// Check if summary is cached and still valid (24 hours)
function getCachedSummary(cacheKey) {
  const cached = summaryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
    return cached.summary;
  }
  return null;
}

// Side Panel Management
chrome.action.onClicked.addListener(async (tab) => {
  // Toggle side panel when extension icon is clicked
  await chrome.sidePanel.open({ tabId: tab.id });
});

// Auto-open side panel on YouTube video pages
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('youtube.com/watch')) {
    try {
      // Auto-open side panel for YouTube videos
      await chrome.sidePanel.open({ tabId: tabId });
    } catch (error) {
      // Side panel might already be open or not available
      console.log('Could not auto-open side panel:', error.message);
    }
  }
});

// Handle tab activation to update side panel content
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    
    // Send message to side panel about tab change (if side panel is open)
    try {
      await chrome.runtime.sendMessage({
        action: 'tabActivated',
        tab: tab
      });
    } catch (error) {
      // Side panel might not be open, which is fine
    }
  } catch (error) {
    console.error('Error handling tab activation:', error);
  }
});

// Handle runtime messages (from side panel and content scripts)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'summarize') {
    handleSummarization(request).then(sendResponse);
    return true;
  }
  
  
  if (request.action === 'openSidePanel') {
    // Request from content script to open side panel
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch(console.error);
    return;
  }
  
  if (request.action === 'checkSidePanelStatus') {
    // Check if side panel is available
    sendResponse({ available: typeof chrome.sidePanel !== 'undefined' });
    return;
  }
  
  if (request.action === 'videoChanged') {
    // Forward video change notification to side panel
    console.log('🔄 Video changed detected:', request.videoId, request.url);
    
    // Try to notify the side panel about the video change
    chrome.runtime.sendMessage({
      action: 'videoChangedNotification',
      videoId: request.videoId,
      tab: {
        id: sender.tab.id,
        url: request.url
      }
    }).catch(() => {
      // Side panel might not be open, which is fine
      console.log('Side panel not available to receive video change notification');
    });
    
    return;
  }
});

async function handleSummarization(request) {
  const { transcript, videoInfo, summaryType, language = 'en' } = request;
  
  // Check cache first
  const cacheKey = generateCacheKey(videoInfo.videoId, summaryType, language);
  const cachedResult = getCachedSummary(cacheKey);
  
  if (cachedResult) {
    console.log('Returning cached summary');
    return { summary: cachedResult, success: true, cached: true };
  }
  
  try {
    // Validate inputs
    if (!transcript) {
      return { error: 'No transcript available' };
    }
    
    if (!videoInfo || !videoInfo.title) {
      return { error: 'Video information not available' };
    }
    
    // Add request timing for analytics
    const startTime = Date.now();
    
    // Chunk very long transcripts for better processing
    const maxChunkSize = 50000;
    const processedTranscript = transcript.length > maxChunkSize 
      ? await processLongTranscript(transcript, maxChunkSize)
      : transcript;
    
    const response = await fetch(`${API_BASE_URL}/api/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-Version': chrome.runtime.getManifest().version, // For analytics
      },
      body: JSON.stringify({
        transcript: processedTranscript,
        videoInfo: videoInfo,
        summaryType: summaryType,
        language: language,
        processingTime: Date.now() - startTime
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to generate summary');
    }
    
    // Cache the successful result
    summaryCache.set(cacheKey, {
      summary: data.summary,
      timestamp: Date.now()
    });
    
    // Clean old cache entries (keep last 50)
    if (summaryCache.size > 50) {
      const firstKey = summaryCache.keys().next().value;
      summaryCache.delete(firstKey);
    }
    
    return { 
      summary: data.summary,
      success: true,
      processingTime: Date.now() - startTime
    };
    
  } catch (error) {
    console.error('Summarization error:', error);
    
    // Enhanced error categorization
    if (error.message.includes('fetch')) {
      return { error: 'Unable to connect to summarization service. Please check your internet connection.' };
    } else if (error.message.includes('429')) {
      return { error: 'Service is busy. Please try again in a moment.' };
    } else if (error.message.includes('500')) {
      return { error: 'Service temporarily unavailable. Please try again later.' };
    } else if (error.message.includes('quota')) {
      return { error: 'Daily quota exceeded. Please try again tomorrow.' };
    } else {
      return { error: error.message || 'Failed to generate summary' };
    }
  }
}


// Process very long transcripts by intelligent chunking
async function processLongTranscript(transcript, maxChunkSize) {
  // Split on sentence boundaries for better context preservation
  const sentences = transcript.split(/[.!?]+\s+/);
  let currentChunk = '';
  const chunks = [];
  
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChunkSize && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += (currentChunk ? '. ' : '') + sentence;
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  // For now, just return the first chunk
  // In future, could implement progressive summarization
  return chunks[0] || transcript.substring(0, maxChunkSize);
}
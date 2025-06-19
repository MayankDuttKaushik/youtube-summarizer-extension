// Enhanced background.js with caching and performance improvements

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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'summarize') {
    handleSummarization(request).then(sendResponse);
    return true;
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
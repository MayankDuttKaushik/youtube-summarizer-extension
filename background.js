// Configuration - Change this to your deployed API URL
const API_BASE_URL = 'https://youtube-summarizer-api-production.up.railway.app';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'summarize') {
    handleSummarization(request).then(sendResponse);
    return true; // Will respond asynchronously
  }
});

async function handleSummarization(request) {
  const { transcript, videoInfo, summaryType, language = 'en' } = request;
  
  try {
    // Validate inputs
    if (!transcript) {
      return { error: 'No transcript available' };
    }
    
    if (!videoInfo || !videoInfo.title) {
      return { error: 'Video information not available' };
    }
    
    // Call your backend API
    const response = await fetch(`${API_BASE_URL}/api/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transcript: transcript,
        videoInfo: videoInfo,
        summaryType: summaryType,
        language: language
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
    
    return { 
      summary: data.summary,
      success: true 
    };
    
  } catch (error) {
    console.error('Summarization error:', error);
    
    // Provide user-friendly error messages
    if (error.message.includes('fetch')) {
      return { error: 'Unable to connect to summarization service. Please check your internet connection.' };
    } else if (error.message.includes('429')) {
      return { error: 'Service is busy. Please try again in a moment.' };
    } else if (error.message.includes('500')) {
      return { error: 'Service temporarily unavailable. Please try again later.' };
    } else {
      return { error: error.message || 'Failed to generate summary' };
    }
  }
}
// Function to get video ID from URL
function getVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

// Function to extract transcript using YouTube's internal API
async function extractTranscript() {
  const videoId = getVideoId();
  if (!videoId) return null;

  // Skip Method 1 for security - removed hardcoded API key
  // Method 1 would require proper API authentication

  // Method 2: Parse from page data
  try {
    // Click on the "Show transcript" button if it exists
    const showTranscriptBtn = Array.from(document.querySelectorAll('button')).find(
      btn => btn.getAttribute('aria-label')?.includes('Show transcript')
    );
    
    if (showTranscriptBtn) {
      showTranscriptBtn.click();
      
      // Wait for transcript to load
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Extract transcript from the panel
      const transcriptSegments = document.querySelectorAll('ytd-transcript-segment-renderer');
      if (transcriptSegments.length > 0) {
        let transcript = '';
        transcriptSegments.forEach(segment => {
          const text = segment.querySelector('.segment-text')?.textContent?.trim();
          if (text) {
            transcript += text + ' ';
          }
        });
        
        // Close the transcript panel
        const closeBtn = document.querySelector('button[aria-label*="Close transcript"]');
        if (closeBtn) closeBtn.click();
        
        return transcript.trim();
      }
    }
  } catch (error) {
    console.log('Method 2 failed, trying final method...');
  }

  // Method 3: Try to extract from ytInitialPlayerResponse
  try {
    const scripts = Array.from(document.querySelectorAll('script'));
    for (const script of scripts) {
      if (script.textContent?.includes('ytInitialPlayerResponse')) {
        const match = script.textContent.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;/);
        if (match) {
          const playerResponse = JSON.parse(match[1]);
          const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          
          if (captionTracks && captionTracks.length > 0) {
            // Find best available captions: auto-generated first, then any language
            const track = captionTracks.find(t => t.kind === 'asr') || // Auto-generated (any language)
                         captionTracks.find(t => t.languageCode === 'en') || // English manual captions
                         captionTracks[0]; // Any available captions
            
            if (track && track.baseUrl) {
              const captionResponse = await fetch(track.baseUrl);
              const captionText = await captionResponse.text();
              
              // Parse the caption XML
              const parser = new DOMParser();
              const xmlDoc = parser.parseFromString(captionText, 'text/xml');
              const textElements = xmlDoc.querySelectorAll('text');
              
              let transcript = '';
              textElements.forEach(element => {
                let text = element.textContent || '';
                // Clean up the text
                text = text.replace(/&amp;/g, '&')
                          .replace(/&lt;/g, '<')
                          .replace(/&gt;/g, '>')
                          .replace(/&quot;/g, '"')
                          .replace(/&#39;/g, "'")
                          .replace(/\n/g, ' ')
                          .trim();
                if (text) {
                  transcript += text + ' ';
                }
              });
              
              return transcript.trim();
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Method 3 failed:', error);
  }

  return null;
}

// Function to get video info with retry for title
async function getVideoInfo() {
  const videoId = getVideoId();
  
  // Function to extract title with multiple selectors
  function extractTitle() {
    return document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent?.trim() || 
           document.querySelector('h1.title')?.textContent?.trim() ||
           document.querySelector('yt-formatted-string.ytd-video-primary-info-renderer')?.textContent?.trim() ||
           document.querySelector('#container h1 yt-formatted-string')?.textContent?.trim() ||
           document.querySelector('h1[class*="title"]')?.textContent?.trim() ||
           null;
  }
  
  // Function to check if title seems valid for current video
  function isTitleValid(title) {
    if (!title) return false;
    if (title.includes('YouTube')) return false;
    if (title.includes('Loading...')) return false;
    if (title.length < 3) return false;
    return true;
  }
  
  // Function to extract channel name
  function extractChannel() {
    return document.querySelector('#channel-name a')?.textContent?.trim() ||
           document.querySelector('#owner #channel-name')?.textContent?.trim() ||
           document.querySelector('ytd-channel-name a')?.textContent?.trim() ||
           document.querySelector('#upload-info #channel-name')?.textContent?.trim();
  }
  
  // Try to get title immediately
  let videoTitle = extractTitle();
  
  // If no valid title found, wait and retry
  if (!isTitleValid(videoTitle)) {
    console.log('⏳ Waiting for YouTube to update title...');
    
    // Wait up to 5 seconds for YouTube to update the title  
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const newTitle = extractTitle();
      if (isTitleValid(newTitle)) {
        videoTitle = newTitle;
        console.log('✅ Title updated:', videoTitle);
        break;
      }
    }
  }
  
  // Fallback to document title if still no luck
  if (!videoTitle) {
    videoTitle = document.title.replace(' - YouTube', '');
  }
  
  const channelName = extractChannel();
  
  console.log('📺 Video info extracted:', { videoId, title: videoTitle, channel: channelName });
  
  return {
    videoId,
    title: videoTitle,
    channel: channelName,
    url: window.location.href
  };
}

// Function to get video duration
function getVideoDuration() {
  // Try multiple selectors for duration
  const durationEl = document.querySelector('span.ytp-time-duration') ||
                     document.querySelector('.ytp-time-duration') ||
                     document.querySelector('[class*="duration"]');
  
  return durationEl ? durationEl.textContent.trim() : null;
}

// Auto-detect video changes and notify side panel
let currentVideoId = null;

function detectVideoChange() {
  const newVideoId = getVideoId();
  if (newVideoId && newVideoId !== currentVideoId) {
    currentVideoId = newVideoId;
    
    console.log('🎬 Video change detected:', newVideoId, window.location.href);
    
    // Add a longer delay to let YouTube fully update the page content
    setTimeout(() => {
      // Notify background script of video change
      chrome.runtime.sendMessage({
        action: 'videoChanged',
        videoId: newVideoId,
        url: window.location.href
      }).catch(() => {
        // Side panel might not be open, which is fine
      });
    }, 2000); // Wait 2 seconds for YouTube to update
  }
}

// Monitor for video changes on YouTube
const observer = new MutationObserver(detectVideoChange);
observer.observe(document.body, { childList: true, subtree: true });

// Initial detection
detectVideoChange();

// Listen for messages from side panel and background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getVideoInfo') {
    getVideoInfo().then(info => {
      sendResponse(info);
    }).catch(error => {
      console.error('Error getting video info:', error);
      sendResponse({ error: 'Failed to get video info' });
    });
    return true; // Will respond asynchronously
  } else if (request.action === 'getTranscript') {
    extractTranscript().then(transcript => {
      sendResponse({ transcript });
    });
    return true; // Will respond asynchronously
  } else if (request.action === 'getDuration') {
    const duration = getVideoDuration();
    sendResponse({ duration });
  } else if (request.action === 'openSidePanel') {
    // Request from page to open side panel
    chrome.runtime.sendMessage({ action: 'openSidePanel' });
  }
});
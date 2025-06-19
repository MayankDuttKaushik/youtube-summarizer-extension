// Function to get video ID from URL
function getVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

// Function to extract transcript using YouTube's internal API
async function extractTranscript() {
  const videoId = getVideoId();
  if (!videoId) return null;

  try {
    // Method 1: Try using the embedded player API endpoint
    const innertubeApiKey = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
    const response = await fetch('https://www.youtube.com/youtubei/v1/get_transcript?key=' + innertubeApiKey, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.0',
          },
        },
        params: btoa(`\n\x0b${videoId}`),
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.actions) {
        const cueGroups = data.actions[0].updateEngagementPanelAction.content.transcriptRenderer.body.transcriptBodyRenderer.cueGroups;
        let transcript = '';
        for (const group of cueGroups) {
          const cue = group.transcriptCueGroupRenderer.cues[0].transcriptCueRenderer;
          transcript += cue.cue.simpleText + ' ';
        }
        return transcript.trim();
      }
    }
  } catch (error) {
    console.log('Method 1 failed, trying alternative method...');
  }

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
            // Find English captions or auto-generated
            const track = captionTracks.find(t => t.languageCode === 'en' || t.kind === 'asr') || captionTracks[0];
            
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

// Function to get video info
function getVideoInfo() {
  // Try multiple selectors for video title
  const videoTitle = document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent?.trim() || 
                     document.querySelector('h1.title')?.textContent?.trim() ||
                     document.querySelector('yt-formatted-string.ytd-video-primary-info-renderer')?.textContent?.trim() ||
                     document.querySelector('#container h1 yt-formatted-string')?.textContent?.trim() ||
                     document.title.replace(' - YouTube', '');
  
  // Try multiple selectors for channel name
  const channelName = document.querySelector('#channel-name a')?.textContent?.trim() ||
                      document.querySelector('#owner #channel-name')?.textContent?.trim() ||
                      document.querySelector('ytd-channel-name a')?.textContent?.trim() ||
                      document.querySelector('#upload-info #channel-name')?.textContent?.trim();
  
  const videoId = getVideoId();
  
  return {
    videoId,
    title: videoTitle,
    channel: channelName,
    url: window.location.href
  };
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getVideoInfo') {
    const info = getVideoInfo();
    sendResponse(info);
  } else if (request.action === 'getTranscript') {
    extractTranscript().then(transcript => {
      sendResponse({ transcript });
    });
    return true; // Will respond asynchronously
  }
});
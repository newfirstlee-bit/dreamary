import mixpanel from 'mixpanel-browser';

const MIXPANEL_TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN || '';
let isInitialized = false;

export const initMixpanel = () => {
  if (typeof window !== 'undefined') {
    if (window.localStorage.getItem('block_analytics') === 'true') return;
    
    if (!MIXPANEL_TOKEN) {
      console.warn('Mixpanel Token is missing! Check .env.local and restart the server.');
      return;
    }
    if (!isInitialized) {
      console.log('Initializing Mixpanel with token:', MIXPANEL_TOKEN);
      mixpanel.init(MIXPANEL_TOKEN, {
        debug: true, // Force debug mode to see logs in console
        track_pageview: true,
        persistence: 'localStorage',
      });
      isInitialized = true;
    }
  }
};

export const identifyUser = (userId: string) => {
  initMixpanel();
  if (isInitialized) {
    mixpanel.identify(userId);
  }
};

export const trackEvent = (eventName: string, properties?: Record<string, any>) => {
  initMixpanel();
  if (isInitialized) {
    console.log(`Tracking Event: ${eventName}`, properties);
    mixpanel.track(eventName, properties);
  } else {
    console.warn(`Failed to track ${eventName}: Mixpanel not initialized.`);
  }
};

import mixpanel from 'mixpanel-browser';

const MIXPANEL_TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN || '';
let isInitialized = false;

export const initMixpanel = () => {
  if (typeof window !== 'undefined' && MIXPANEL_TOKEN && !isInitialized) {
    mixpanel.init(MIXPANEL_TOKEN, {
      debug: process.env.NODE_ENV !== 'production',
      track_pageview: true,
      persistence: 'localStorage',
    });
    isInitialized = true;
  }
};

export const identifyUser = (userId: string) => {
  if (isInitialized) {
    mixpanel.identify(userId);
  }
};

export const trackEvent = (eventName: string, properties?: Record<string, any>) => {
  if (isInitialized) {
    mixpanel.track(eventName, properties);
  }
};

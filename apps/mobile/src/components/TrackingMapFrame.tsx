import { forwardRef, useImperativeHandle, useRef } from 'react';
import { WebView } from 'react-native-webview';
import type { StyleProp, ViewStyle } from 'react-native';

export interface TrackingMapFrameHandle {
  /** Runs a script inside the map document, e.g. `window.updatePosition(12.9, 77.5, 90)`. */
  run(script: string): void;
}

export interface TrackingMapFrameProps {
  html: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Native shell for the live tracking map: an embedded WebView, addressed with `injectJavaScript`
 * exactly as it was before this file existed.
 *
 * `react-native-webview` does not render in a browser, so the web sibling opens the same document in
 * a `srcdoc` iframe instead — same-origin, which lets the React side call into Leaflet directly.
 */
const TrackingMapFrame = forwardRef<TrackingMapFrameHandle, TrackingMapFrameProps>(
  function TrackingMapFrame({ html, style }, ref) {
    // `any` mirrors how the WebView handle was held before it was split out of LiveTrackingView:
    // `react-native-webview` types its class instance in a way `useRef<WebView>` will not accept.
    const webView = useRef<any>(null);

    useImperativeHandle(ref, () => ({
      run: (script: string) => {
        webView.current?.injectJavaScript(script);
      },
    }));

    return (
      <WebView
        ref={webView}
        originWhitelist={['*']}
        source={{ html }}
        style={style}
        scrollEnabled={false}
      />
    );
  },
);

export default TrackingMapFrame;

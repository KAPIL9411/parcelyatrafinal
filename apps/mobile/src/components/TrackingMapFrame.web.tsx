import { forwardRef, useImperativeHandle, useRef } from 'react';

import type { TrackingMapFrameHandle, TrackingMapFrameProps } from './TrackingMapFrame';

/**
 * Browser shell for the live tracking map.
 *
 * `react-native-webview` refuses to render on web, so the same Leaflet document opens in an iframe.
 * A `srcdoc` frame is same-origin, which lets this side call `window.updatePosition` and
 * `window.setPolyline` directly instead of going through `injectJavaScript`.
 */
const TrackingMapFrame = forwardRef<TrackingMapFrameHandle, TrackingMapFrameProps>(
  function TrackingMapFrame({ html, style }, ref) {
    const frame = useRef<HTMLIFrameElement | null>(null);

    useImperativeHandle(ref, () => ({
      run: (script: string) => {
        const win = frame.current?.contentWindow as
          | (Window & { eval: (script: string) => unknown })
          | null
          | undefined;
        try {
          win?.eval(script);
        } catch {
          // The frame is mid-navigation; the next position lands and the map catches up.
        }
      },
    }));

    return (
      <iframe
        ref={frame}
        title="Live parcel tracking"
        srcDoc={html}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
          background: '#F8FAFC',
          ...(style as Record<string, unknown>),
        }}
      />
    );
  },
);

export default TrackingMapFrame;

import { forwardRef, useImperativeHandle, useRef } from 'react';

import type { MapFrameHandle, MapFrameProps } from './MapFrame';

/**
 * Web shell for the same map document. `react-native-webview` refuses to render on web, so the page
 * goes in an iframe; a `srcdoc` frame is same-origin, which lets the React side call straight into
 * the Leaflet document the way `injectJavaScript` does on native.
 */
export const MapFrame = forwardRef<MapFrameHandle, MapFrameProps>(function MapFrame(
  { html, height, style, onReady },
  ref,
) {
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
        // The frame navigated away between render and call; the next script lands.
      }
    },
  }));

  return (
    <iframe
      ref={frame}
      title="Route map"
      srcDoc={html}
      onLoad={onReady}
      style={{
        width: '100%',
        height: `${height}px`,
        border: 'none',
        display: 'block',
        background: '#eaeef5',
        ...(style as Record<string, unknown>),
      }}
    />
  );
});

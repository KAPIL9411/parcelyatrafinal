import { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

export interface MapFrameHandle {
  /** Evaluate a script inside the map document. */
  run: (script: string) => void;
}

export interface MapFrameProps {
  html: string;
  height: number;
  style?: ViewStyle;
  onReady?: () => void;
}

/**
 * Native shell for the map document. The page reports ready through `onLoadEnd`; scripts are pushed
 * in with `injectJavaScript`, which is the only way into a WebView's document.
 */
export const MapFrame = forwardRef<MapFrameHandle, MapFrameProps>(function MapFrame(
  { html, height, style, onReady },
  ref,
) {
  // The package's root typings declare `WebView<P = undefined>`, so an intersection with the default
  // generic leaves the props type uninferable; the handle is left loose, as in LiveTrackingView.
  const frame = useRef<any>(null);

  useImperativeHandle(ref, () => ({
    run: (script: string) => {
      frame.current?.injectJavaScript(`${script}; true;`);
    },
  }));

  return (
    <WebView
      ref={frame}
      source={{ html }}
      originWhitelist={['*']}
      style={[styles.frame, { height }, style]}
      onLoadEnd={onReady}
      scrollEnabled={false}
      setSupportMultipleWindows={false}
      androidLayerType="hardware"
      overScrollMode="never"
    />
  );
});

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: 'transparent', width: '100%' },
});

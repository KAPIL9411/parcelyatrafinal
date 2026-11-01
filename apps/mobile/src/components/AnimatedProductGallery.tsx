import React, { useEffect } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  ImageSourcePropType,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const USE_NATIVE_DRIVER = Platform.OS !== 'web';

export interface ProductItem {
  id: string;
  image: ImageSourcePropType;
  bgColor: string;
}

// The renders in `assets/productsfinal` are cut out on transparency, so each tile is a light wash
// that holds the object without fighting the shading already in the artwork.
const TILE_BLUE = '#EEF3FF';
const TILE_MIST = '#F2F6F9';
const TILE_SAND = '#F8F4EE';

const PRODUCTS: Record<string, ProductItem> = {
  laptop: {
    id: 'laptop',
    image: require('../../assets/productsfinal/Floating Blue-Silver Laptop Hero Render.webp'),
    bgColor: TILE_BLUE,
  },
  smartphone: {
    id: 'smartphone',
    image: require('../../assets/productsfinal/Floating Blue Smartphone Render.webp'),
    bgColor: TILE_MIST,
  },
  charging_bundle: {
    id: 'charging_bundle',
    image: require('../../assets/productsfinal/Charging Essentials Product Bundle.webp'),
    bgColor: TILE_BLUE,
  },
  macbook_foam: {
    id: 'macbook_foam',
    image: require('../../assets/productsfinal/MacBook Packaged in Protective Foam.webp'),
    bgColor: TILE_MIST,
  },
  polo_stack: {
    id: 'polo_stack',
    image: require('../../assets/productsfinal/Floating Blue Polo Clothing Stack.webp'),
    bgColor: TILE_BLUE,
  },
  box_clothes: {
    id: 'box_clothes',
    image: require('../../assets/productsfinal/Open Cardboard Box with Folded Clothes.webp'),
    bgColor: TILE_SAND,
  },
  sneakers: {
    id: 'sneakers',
    image: require('../../assets/productsfinal/Floating White and Blue Sneakers.webp'),
    bgColor: TILE_MIST,
  },
  backpack: {
    id: 'backpack',
    image: require('../../assets/productsfinal/Floating Navy Backpack Showcase.webp'),
    bgColor: TILE_BLUE,
  },
  book_stack: {
    id: 'book_stack',
    image: require('../../assets/productsfinal/Floating Colorful Book Stack.webp'),
    bgColor: TILE_MIST,
  },
  notebooks: {
    id: 'notebooks',
    image: require('../../assets/productsfinal/Stacked Books and Spiral Notebooks.webp'),
    bgColor: TILE_SAND,
  },
  roses: {
    id: 'roses',
    image: require('../../assets/productsfinal/Elegant Red Rose Bouquet with Satin Bow.webp'),
    bgColor: TILE_MIST,
  },
  tiffin: {
    id: 'tiffin',
    image: require('../../assets/productsfinal/Packed Stainless Steel Tiffin Set.webp'),
    bgColor: TILE_SAND,
  },
  kraft_envelope: {
    id: 'kraft_envelope',
    image: require('../../assets/productsfinal/Kraft Envelope with Colorful Documents.webp'),
    bgColor: TILE_SAND,
  },
  pharmacy: {
    id: 'pharmacy',
    image: require('../../assets/productsfinal/Floating Pharmaceutical Collection.webp'),
    bgColor: TILE_MIST,
  },
};

// Fourteen renders across four rows of four: the first three rows carry twelve of them, the fourth
// adds the remaining two and reuses two from other rows, so no loop shows the same object twice.
const ROW_1: ProductItem[] = [
  PRODUCTS.laptop,
  PRODUCTS.kraft_envelope,
  PRODUCTS.book_stack,
  PRODUCTS.sneakers,
];

const ROW_2: ProductItem[] = [
  PRODUCTS.smartphone,
  PRODUCTS.polo_stack,
  PRODUCTS.pharmacy,
  PRODUCTS.macbook_foam,
];

const ROW_3: ProductItem[] = [
  PRODUCTS.charging_bundle,
  PRODUCTS.backpack,
  PRODUCTS.box_clothes,
  PRODUCTS.notebooks,
];

const ROW_4: ProductItem[] = [
  PRODUCTS.roses,
  PRODUCTS.box_clothes,
  PRODUCTS.tiffin,
  PRODUCTS.book_stack,
];

interface AnimatedRowProps {
  items: ProductItem[];
  direction: 'left' | 'right';
  durationMs: number;
  cardWidth: number;
  cardHeight: number;
  cardGap: number;
  reduceMotion: boolean;
}

function AnimatedRow({
  items,
  direction,
  durationMs,
  cardWidth,
  cardHeight,
  cardGap,
  reduceMotion,
}: AnimatedRowProps) {
  const [animatedValue] = React.useState(() => new Animated.Value(0));
  const itemTotalWidth = cardWidth + cardGap;
  const loopDistance = items.length * itemTotalWidth;

  const loopedItems = [...items, ...items, ...items];

  useEffect(() => {
    if (reduceMotion) {
      animatedValue.setValue(0);
      return;
    }

    animatedValue.setValue(0);
    const animation = Animated.loop(
      Animated.timing(animatedValue, {
        toValue: 1,
        duration: durationMs,
        easing: Easing.linear,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [animatedValue, durationMs, reduceMotion]);

  const translateX = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange:
      direction === 'left'
        ? [0, -loopDistance]
        : [-loopDistance, 0],
  });

  return (
    <View style={[styles.rowContainer, { marginVertical: cardGap / 2 }]}>
      <Animated.View
        style={[
          styles.rowTrack,
          {
            transform: [{ translateX }],
          },
        ]}
      >
        {loopedItems.map((item, index) => (
          <View
            key={`${item.id}-${index}`}
            style={[
              styles.card,
              {
                width: cardWidth,
                height: cardHeight,
                marginHorizontal: cardGap / 2,
                borderRadius: Math.round(cardHeight * 0.26),
                backgroundColor: item.bgColor,
              },
            ]}
          >
            <Image
              source={item.image}
              style={styles.cardImage}
              resizeMode="contain"
            />
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

export function AnimatedProductGallery({ galleryHeight }: { galleryHeight?: number }) {
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = React.useState(false);
  const [entranceAnim] = React.useState(() => new Animated.Value(0));

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => listener.remove();
  }, []);

  useEffect(() => {
    Animated.timing(entranceAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }, [entranceAnim]);

  // Gallery occupies ~61% of screen height matching Blinkit reference
  const actualHeight = galleryHeight ?? Math.round(screenHeight * 0.61);

  // The productsfinal renders are 3:2 cut-outs, so the tiles are landscape too — a square tile
  // would shrink every object to half its own height and leave the rest of the card empty.
  const cardWidth = Math.max(104, Math.min(Math.round(screenWidth * 0.32), 132));
  const cardHeight = Math.round(cardWidth * (2 / 3));
  const cardGap = Math.max(12, Math.round(screenWidth * 0.035));

  return (
    <View style={[styles.galleryWrapper, { height: actualHeight }]}>
      <Animated.View
        style={[
          styles.gridContainer,
          {
            opacity: entranceAnim,
            paddingTop: 10,
          },
        ]}
      >
        <AnimatedRow
          items={ROW_1}
          direction="left"
          durationMs={22000}
          cardWidth={cardWidth}
          cardHeight={cardHeight}
          cardGap={cardGap}
          reduceMotion={reduceMotion}
        />
        <AnimatedRow
          items={ROW_2}
          direction="right"
          durationMs={28000}
          cardWidth={cardWidth}
          cardHeight={cardHeight}
          cardGap={cardGap}
          reduceMotion={reduceMotion}
        />
        <AnimatedRow
          items={ROW_3}
          direction="left"
          durationMs={20000}
          cardWidth={cardWidth}
          cardHeight={cardHeight}
          cardGap={cardGap}
          reduceMotion={reduceMotion}
        />
        <AnimatedRow
          items={ROW_4}
          direction="right"
          durationMs={26000}
          cardWidth={cardWidth}
          cardHeight={cardHeight}
          cardGap={cardGap}
          reduceMotion={reduceMotion}
        />
      </Animated.View>

      {/* Smooth bottom fade matching Blinkit reference where row 4 dissolves into pure white */}
      <LinearGradient
        colors={[
          'rgba(255, 255, 255, 0)',
          'rgba(255, 255, 255, 0.45)',
          'rgba(255, 255, 255, 0.92)',
          '#FFFFFF',
        ]}
        locations={[0, 0.4, 0.75, 1]}
        style={styles.bottomFade}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  galleryWrapper: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    position: 'relative',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  gridContainer: {
    width: '100%',
    alignItems: 'center',
  },
  rowContainer: {
    width: '100%',
    overflow: 'hidden',
    flexDirection: 'row',
  },
  rowTrack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  card: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  bottomFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 140,
  },
});

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

// Signature soft ice-cyan pastel background matching Blinkit product cards exactly
const CARD_BG = '#EBF5F8';

const PRODUCTS: Record<string, ProductItem> = {
  toor_dal: {
    id: 'toor_dal',
    image: require('../../assets/products/toor_dal.webp'),
    bgColor: CARD_BG,
  },
  broccoli: {
    id: 'broccoli',
    image: require('../../assets/products/broccoli.webp'),
    bgColor: CARD_BG,
  },
  fortune_oil: {
    id: 'fortune_oil',
    image: require('../../assets/products/fortune_oil.webp'),
    bgColor: CARD_BG,
  },
  led_bulb: {
    id: 'led_bulb',
    image: require('../../assets/products/led_bulb.webp'),
    bgColor: CARD_BG,
  },
  extension_cord: {
    id: 'extension_cord',
    image: require('../../assets/products/extension_cord.webp'),
    bgColor: CARD_BG,
  },
  wooden_spoons: {
    id: 'wooden_spoons',
    image: require('../../assets/products/wooden_spoons.webp'),
    bgColor: CARD_BG,
  },
  durex_box: {
    id: 'durex_box',
    image: require('../../assets/products/durex_box.webp'),
    bgColor: CARD_BG,
  },
  pampers: {
    id: 'pampers',
    image: require('../../assets/products/pampers.webp'),
    bgColor: CARD_BG,
  },
  electric_kettle: {
    id: 'electric_kettle',
    image: require('../../assets/products/electric_kettle.webp'),
    bgColor: CARD_BG,
  },
  parcel_box: {
    id: 'parcel_box',
    image: require('../../assets/products/parcel_box.webp'),
    bgColor: CARD_BG,
  },
  blue_suitcase: {
    id: 'blue_suitcase',
    image: require('../../assets/products/blue_suitcase.webp'),
    bgColor: '#EAF2FA',
  },
  laptop_macbook: {
    id: 'laptop_macbook',
    image: require('../../assets/products/laptop_macbook.webp'),
    bgColor: '#F0EFF9',
  },
  courier_envelope: {
    id: 'courier_envelope',
    image: require('../../assets/products/courier_envelope.webp'),
    bgColor: CARD_BG,
  },
  travel_backpack: {
    id: 'travel_backpack',
    image: require('../../assets/products/travel_backpack.webp'),
    bgColor: '#EAF2F9',
  },
  headphones: {
    id: 'headphones',
    image: require('../../assets/products/headphones.webp'),
    bgColor: '#F8EFF2',
  },
  sneakers: {
    id: 'sneakers',
    image: require('../../assets/products/sneakers.webp'),
    bgColor: CARD_BG,
  },
  camera: {
    id: 'camera',
    image: require('../../assets/products/camera.webp'),
    bgColor: '#F8F4EE',
  },
  box_logo: {
    id: 'box_logo',
    image: require('../../assets/products/box_logo.webp'),
    bgColor: CARD_BG,
  },
};

const ROW_1: ProductItem[] = [
  PRODUCTS.toor_dal,
  PRODUCTS.broccoli,
  PRODUCTS.parcel_box,
  PRODUCTS.blue_suitcase,
  PRODUCTS.fortune_oil,
];

const ROW_2: ProductItem[] = [
  PRODUCTS.led_bulb,
  PRODUCTS.laptop_macbook,
  PRODUCTS.extension_cord,
  PRODUCTS.wooden_spoons,
  PRODUCTS.travel_backpack,
];

const ROW_3: ProductItem[] = [
  PRODUCTS.durex_box,
  PRODUCTS.sneakers,
  PRODUCTS.pampers,
  PRODUCTS.courier_envelope,
  PRODUCTS.box_logo,
];

const ROW_4: ProductItem[] = [
  PRODUCTS.electric_kettle,
  PRODUCTS.fortune_oil,
  PRODUCTS.toor_dal,
  PRODUCTS.headphones,
  PRODUCTS.camera,
];

interface AnimatedRowProps {
  items: ProductItem[];
  direction: 'left' | 'right';
  durationMs: number;
  cardSize: number;
  cardGap: number;
  reduceMotion: boolean;
}

function AnimatedRow({
  items,
  direction,
  durationMs,
  cardSize,
  cardGap,
  reduceMotion,
}: AnimatedRowProps) {
  const [animatedValue] = React.useState(() => new Animated.Value(0));
  const itemTotalWidth = cardSize + cardGap;
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
                width: cardSize,
                height: cardSize,
                marginHorizontal: cardGap / 2,
                borderRadius: Math.round(cardSize * 0.26),
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

  // Cards scale to ~23.5% of screen width (around 88-92dp on typical phones)
  const cardSize = Math.max(76, Math.min(Math.round(screenWidth * 0.235), 96));
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
          cardSize={cardSize}
          cardGap={cardGap}
          reduceMotion={reduceMotion}
        />
        <AnimatedRow
          items={ROW_2}
          direction="right"
          durationMs={28000}
          cardSize={cardSize}
          cardGap={cardGap}
          reduceMotion={reduceMotion}
        />
        <AnimatedRow
          items={ROW_3}
          direction="left"
          durationMs={20000}
          cardSize={cardSize}
          cardGap={cardGap}
          reduceMotion={reduceMotion}
        />
        <AnimatedRow
          items={ROW_4}
          direction="right"
          durationMs={26000}
          cardSize={cardSize}
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

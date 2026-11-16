/**
 * One photo served behind a bearer (answer evaluations, DECISIONS T.8). The server sends it with
 * Cache-Control: no-store; the token is read fresh for each mount and never logged.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/tokens';

export function AuthedPhoto({
  url,
  getToken,
  style,
  onPress,
  accessibilityLabel,
  testID,
}: {
  url: string;
  getToken: () => Promise<string | null>;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void getToken().then((tk) => live && setToken(tk));
    return () => {
      live = false;
    };
  }, [getToken]);

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'imagebutton' : 'image'}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[styles.box, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }, style]}
    >
      {token ? (
        <Image
          source={{ uri: url, headers: { Authorization: `Bearer ${token}` }, cache: 'reload' }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
        />
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={colors.inkMuted} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

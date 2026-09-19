import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EdgeSurface } from '@/components/EdgeSurface';
import { IconBadge } from '@/components/IconBadge';
import { MentorPageHeader } from '@/components/mentor/MentorPageHeader';
import { Entrance } from '@/components/motion/Entrance';
import { SageSky } from '@/components/motion/SageSky';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

/** Reading 1 (board A10 / A37 link to A12). The reading itself is not written yet, so
 * this page says so plainly — a still page, no progress, nothing to tick. */
export default function MentorReading() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <SageSky shape="top" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <MentorPageHeader
          eyebrow={t('mentorHomePage.readingEyebrow')}
          title={t('mentorHomePage.readingTitle')}
          onBack={() => router.back()}
        />
        <Entrance index={0}>
          <EdgeSurface
            edge={colors.edgeSurface}
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            testID="mentor-reading"
          >
            <IconBadge icon="book-outline" tone="orange" size={44} />
            <Text style={[type.title, { color: colors.ink }]} accessibilityRole="header">
              {t('mentorHomePage.readingPageTitle')}
            </Text>
            <Text style={[type.body, { color: colors.ink }]}>{t('mentorHomePage.readingPageBody')}</Text>
          </EdgeSurface>
        </Entrance>
        <Entrance index={1}>
          <View style={[styles.hold, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <Text style={[type.note, { color: colors.inkMuted }]}>{t('mentorHomePage.readingPageHold')}</Text>
          </View>
        </Entrance>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg, gap: 14 },
  card: { padding: 20, gap: space.sm, alignItems: 'flex-start', borderWidth: 1 },
  hold: { padding: space.md, borderWidth: 1, borderRadius: 22 },
});

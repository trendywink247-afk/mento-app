import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Keyboard, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { PressKey } from '@/components/motion/PressKey';
import { CompanionNameField } from '@/components/onboarding/CompanionNameField';
import { api, ApiError } from '@/lib/api';
import { checkCompanionName } from '@/lib/companionName';
import { useI18n } from '@/lib/i18n';
import { screenCache } from '@/lib/screenCache';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

type Problem = 'invalid' | 'failed' | null;

/** Profile's companion card: the name the member gave their companion, and an inline edit
 * in the same pillow field as the companion pick (founder ruling 2026-09-19). Saving an
 * empty field removes the name. The name is the member's own — only this screen and the
 * Ready step ever show it; it never leaves the account for anyone else. */
export function CompanionNameRow({ animal }: { animal: string | null }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  // Last-loaded value first (screenCache is cleared with the identity), then a quiet refresh.
  const [name, setName] = useState<string | null | undefined>(() => screenCache.get('companionName'));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<Problem>(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void api
        .me()
        .then((me) => {
          const value = me.companion_name ?? null;
          screenCache.set('companionName', value);
          if (active) setName(value);
        })
        .catch(() => {
          /* reason: best-effort — the row keeps its last value and goes still */
        });
      return () => {
        active = false;
      };
    }, []),
  );

  const check = checkCompanionName(draft);
  const invalid = problem === 'invalid' || check.state === 'invalid';

  const open = () => {
    setDraft(name ?? '');
    setProblem(null);
    setEditing(true);
  };
  const close = () => {
    Keyboard.dismiss();
    setEditing(false);
    setProblem(null);
  };

  const save = async (value: string | null) => {
    setSaving(true);
    setProblem(null);
    try {
      const me = await api.saveCompanion({ companion_name: value });
      const kept = me.companion_name ?? null;
      screenCache.set('companionName', kept);
      setName(kept);
      close();
    } catch (e) {
      // A refused name says why, calmly; anything else is an honest "not just now".
      setProblem(e instanceof ApiError && e.code === 'companion_name_invalid' ? 'invalid' : 'failed');
    } finally {
      setSaving(false);
    }
  };

  const onSave = () => {
    if (check.state === 'invalid') {
      setProblem('invalid');
      return;
    }
    if (check.state === 'empty') {
      if (name) void save(null);
      else close();
      return;
    }
    if (check.name === name) {
      close();
      return;
    }
    void save(check.name);
  };

  if (!editing) {
    return (
      <View style={styles.row}>
        <Ionicons name="paw-outline" size={18} color={colors.accent} />
        <Text
          style={[styles.name, { color: name ? colors.ink : colors.inkMuted }, !name && styles.none]}
          numberOfLines={1}
          accessibilityLabel={name ? t('profilePage.companionNameA11y', { name }) : undefined}
          testID="profile-companion-name"
        >
          {name ?? (name === undefined ? ' ' : t('profilePage.companionNameNone'))}
        </Text>
        <PressKey
          onPress={open}
          edge={colors.edgeSurface}
          travel={2}
          radius={radius.pill}
          intent="navigate"
          accessibilityLabel={t('profilePage.companionNameEditA11y')}
          testID="profile-companion-name-edit"
          style={[styles.editKey, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[type.label, { color: colors.accentEdge }]}>
            {name ? t('profilePage.companionNameEdit') : t('profilePage.companionNameAdd')}
          </Text>
        </PressKey>
      </View>
    );
  }

  return (
    <View style={styles.editor}>
      <CompanionNameField
        value={draft}
        onChangeText={(v) => {
          setDraft(v);
          if (problem) setProblem(null);
        }}
        animal={animal}
        invalid={invalid}
        onSubmitEditing={onSave}
        autoFocus
        testID="profile-companion-name-input"
      />
      {/* Still, plain words — nothing shakes (T&S #11). */}
      {invalid ? (
        <Text style={[type.caption, { color: colors.danger }]} testID="profile-companion-name-invalid">
          {t('onboarding.companionName.invalid')}
        </Text>
      ) : problem === 'failed' ? (
        <Text style={[type.caption, { color: colors.danger }]} testID="profile-companion-name-failed">
          {t('profilePage.companionNameFailed')}
        </Text>
      ) : (
        <Text style={[type.caption, { color: colors.inkMuted }]}>{t('profilePage.companionNameOnlyYou')}</Text>
      )}
      <View style={styles.keys}>
        {name ? (
          <PressKey
            onPress={() => void save(null)}
            disabled={saving}
            edge="transparent"
            travel={2}
            radius={radius.pill}
            testID="profile-companion-name-remove"
            containerStyle={styles.removeBox}
            style={styles.remove}
          >
            <Text style={[type.label, { color: colors.inkMuted }]}>{t('profilePage.companionNameRemove')}</Text>
          </PressKey>
        ) : (
          <View style={styles.removeBox} />
        )}
        <View style={styles.keyCell}>
          <PrimaryButton
            label={t('profilePage.companionNameCancel')}
            variant="surface"
            onPress={close}
            disabled={saving}
            testID="profile-companion-name-cancel"
          />
        </View>
        <View style={styles.keyCell}>
          <PrimaryButton
            label={t('profilePage.companionNameSave')}
            onPress={onSave}
            loading={saving}
            disabled={invalid}
            testID="profile-companion-name-save"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: 2, minHeight: 44 },
  name: { flex: 1, minWidth: 0, fontFamily: font.sansBold, fontSize: 16, lineHeight: 22 },
  none: { fontFamily: font.sans },
  editKey: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1 },
  editor: { gap: 6 },
  keys: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 4 },
  removeBox: { flex: 1 },
  remove: { minHeight: 44, justifyContent: 'center' },
  keyCell: { flex: 1 },
});

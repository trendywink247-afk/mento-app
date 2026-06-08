// Single route file. The implementation is platform-split in components/chat:
// Metro resolves ChatScreen.web.tsx on web (stream-chat JS client + custom UI) and
// ChatScreen.tsx on native (stream-chat-expo UI kit). Keeping the split in a directly
// imported component — not in route files — ensures expo-router's require.context never
// pulls the native (stream-chat-expo) build into the web bundle.
export { default } from '@/components/chat/ChatScreen';

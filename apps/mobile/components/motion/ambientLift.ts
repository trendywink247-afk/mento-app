/**
 * ambientLift — a module-level shared value the aurora shader reads as its uLift
 * uniform. 0 = normal sky; >0 lifts the sky toward the accent (the "found someone"
 * beat). A singleton (makeMutable) rather than prop-drilling because the canvas is
 * platform-split and lazy-loaded on web; whoever raises it must settle it back to 0.
 */
import { makeMutable } from 'react-native-reanimated';

export const ambientLift = makeMutable(0);

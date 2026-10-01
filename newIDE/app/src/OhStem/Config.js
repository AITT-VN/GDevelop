// @flow

// Keep the OhStem changes behind a build flag so upstream development builds
// retain their original behavior.
export const isOhStemMode: boolean =
  process.env.REACT_APP_OHSTEM_MODE === 'true';

const guestLearnerStorageKey = 'ohstem-game-studio:guest-learner';
const isValidLearner = (learner: string): boolean =>
  /^[A-Za-z0-9_-]{1,128}$/.test(learner);
let inMemoryGuestLearner: ?string = null;

export const getLearnerId = (): ?string => {
  if (!isOhStemMode || typeof window === 'undefined') return null;
  const learner = new URL(window.location.href).searchParams.get('learner');
  if (learner !== null) return isValidLearner(learner) ? learner : null;

  if (inMemoryGuestLearner) return inMemoryGuestLearner;
  try {
    const savedGuest = window.localStorage.getItem(guestLearnerStorageKey);
    if (savedGuest && isValidLearner(savedGuest)) {
      inMemoryGuestLearner = savedGuest;
    } else {
      inMemoryGuestLearner = `guest_${window.crypto
        .randomUUID()
        .replace(/-/g, '')}`;
      window.localStorage.setItem(guestLearnerStorageKey, inMemoryGuestLearner);
    }
  } catch (error) {
    // Keep a usable workspace when browser storage access is restricted.
    inMemoryGuestLearner = 'guest_local';
  }
  return inMemoryGuestLearner;
};

export const isValidSlot = (slot: string): boolean =>
  /^[A-Za-z0-9_-]{1,128}$/.test(slot);

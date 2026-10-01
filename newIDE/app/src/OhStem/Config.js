// @flow

// Keep the OhStem changes behind a build flag so upstream development builds
// retain their original behavior.
export const isOhStemMode: boolean =
  process.env.REACT_APP_OHSTEM_MODE === 'true';

export const getLearnerId = (): ?string => {
  if (!isOhStemMode || typeof window === 'undefined') return null;
  const learner = new URL(window.location.href).searchParams.get('learner');
  return learner && /^[A-Za-z0-9_-]{1,128}$/.test(learner)
    ? learner
    : null;
};

export const isValidSlot = (slot: string): boolean =>
  /^[A-Za-z0-9_-]{1,128}$/.test(slot);

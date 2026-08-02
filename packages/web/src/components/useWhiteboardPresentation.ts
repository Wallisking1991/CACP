import { useCallback, useEffect, useState } from "react";

const WhiteboardOnboardingVersion = 1;

function onboardingKey(roomId: string, participantId: string): string {
  return `cacp.whiteboard.onboarding.v${WhiteboardOnboardingVersion}:${roomId}:${participantId}`;
}

function onboardingWasDismissed(roomId: string, participantId: string) {
  try {
    return localStorage.getItem(onboardingKey(roomId, participantId)) === "1";
  } catch {
    return false;
  }
}

export function useWhiteboardOnboarding(
  roomId: string,
  participantId: string
): { visible: boolean; dismiss(): void } {
  const identity = onboardingKey(roomId, participantId);
  const [dismissedIdentity, setDismissedIdentity] = useState<string>();
  const visible =
    dismissedIdentity !== identity &&
    !onboardingWasDismissed(roomId, participantId);
  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(identity, "1");
    } catch {
      // The hint can still be dismissed for this mount when storage is blocked.
    }
    setDismissedIdentity(identity);
  }, [identity]);
  return { visible, dismiss };
}

export function usePhoneWhiteboard(): boolean {
  const [matches, setMatches] = useState(() =>
    typeof matchMedia === "function"
      ? matchMedia("(max-width: 720px)").matches
      : false
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia("(max-width: 720px)");
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return matches;
}

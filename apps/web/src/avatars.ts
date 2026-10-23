import type { Avatar } from "@scp/protocol";

/** Avatars are emoji (rendered by the device's own emoji font), so there are no image assets to license. */
export const AVATARS: Record<Avatar, { emoji: string; label: string }> = {
  tiger: { emoji: "🐯", label: "Tiger" },
  peacock: { emoji: "🦚", label: "Peacock" },
  elephant: { emoji: "🐘", label: "Elephant" },
  cobra: { emoji: "🐍", label: "Cobra" },
  parrot: { emoji: "🦜", label: "Parrot" },
  lotus: { emoji: "🪷", label: "Lotus" },
  mango: { emoji: "🥭", label: "Mango" },
  rocket: { emoji: "🚀", label: "Rocket" },
};

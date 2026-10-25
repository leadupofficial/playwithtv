/**
 * Two Paths deck: "this or that" cards. Both partners pick in secret; the same pick fills a heart.
 * Add a card: copy a line, keep both options short (they also show on the phone buttons, ~26 characters).
 * Tones: sweet (romantic), silly (playful), deep (talk-it-over), spicy (adults only, flirty, never explicit).
 */
import type { Card } from "../kitcouple/engine";

const p = (tone: Card["tone"], prompt: string, a: string, b: string): Card => ({ kind: "pick", tone, prompt, options: [a, b] });

export const DECK: Card[] = [
  // ---- sweet ----
  p("sweet", "Our perfect first date…", "Picnic under the stars", "Candlelit dinner in town"),
  p("sweet", "A love note should be…", "Handwritten on paper", "A surprise voice message"),
  p("sweet", "Sunday morning together:", "Breakfast in bed", "Pancakes at a café"),
  p("sweet", "The best gift is…", "Something homemade", "A surprise experience"),
  p("sweet", "Our song should be…", "A slow love ballad", "Something we can dance to"),
  p("sweet", "Holding hands or linking arms?", "Holding hands", "Linking arms"),
  p("sweet", "Celebrate a win with…", "A long hug", "A happy dance"),
  p("sweet", "Our dream home is…", "A cottage by the sea", "A loft in the city"),
  p("sweet", "Flowers or chocolates?", "Flowers", "Chocolates"),
  p("sweet", "Watch the sunrise or the sunset?", "Sunrise", "Sunset"),
  p("sweet", "Say I love you…", "Out loud, every day", "With little actions"),
  p("sweet", "A cosy evening means…", "Blanket fort and a film", "Board games and snacks"),
  // ---- silly ----
  p("silly", "On a road trip, the music is…", "Loud singalongs", "A gripping podcast"),
  p("silly", "Would you rather have…", "A pet penguin", "A pet llama"),
  p("silly", "Lost on holiday, we…", "Ask for directions", "Wander and see what happens"),
  p("silly", "Pick a superpower for us:", "Teleporting together", "Reading each other's minds"),
  p("silly", "Pizza topping peace treaty:", "Pineapple welcome", "Pineapple banned forever"),
  p("silly", "For one day, swap…", "Our wardrobes", "Our jobs"),
  p("silly", "Our couple costume:", "Salt and pepper", "Peanut butter and jelly"),
  p("silly", "Would you rather…", "Only whisper for a day", "Only sing for a day"),
  p("silly", "Snack of the road trip:", "Crisps", "Sweets"),
  p("silly", "Camping or a fancy hotel?", "Camping", "Fancy hotel"),
  p("silly", "Our dance style is…", "Smooth and elegant", "Wild and wobbly"),
  p("silly", "If we were animals, we'd be…", "Two otters", "Two pandas"),
  // ---- deep ----
  p("deep", "When we argue, I need…", "Space to cool off", "To talk it out right away"),
  p("deep", "Feeling loved is mostly…", "Words and compliments", "Time spent together"),
  p("deep", "Big life move:", "Travel the world", "Build a home base"),
  p("deep", "A perfect weekend is…", "Out with friends", "Just the two of us"),
  p("deep", "Plans or surprises?", "Plan everything", "Keep it spontaneous"),
  p("deep", "In ten years we're…", "Somewhere new", "Close to family"),
  p("deep", "After a hard day I want…", "A hug and quiet", "A distraction and laughs"),
  p("deep", "Money: save or splurge?", "Save for the future", "Enjoy it now"),
  p("deep", "Our biggest strength is…", "How we laugh", "How we listen"),
  p("deep", "Honest feedback should be…", "Straight to the point", "Gentle and kind"),
  p("deep", "Morning person or night owl?", "Morning person", "Night owl"),
  p("deep", "Remember our story by…", "Photos and albums", "Telling it to friends"),
  // ---- spicy (18+, After Dark) ----
  p("spicy", "The most attractive thing is…", "A confident smile", "A playful wink"),
  p("spicy", "A kiss should be…", "Slow and soft", "Sudden and surprising"),
  p("spicy", "Flirting over text or in person?", "Over text", "In person"),
  p("spicy", "Date night outfit:", "Dressed up to impress", "Comfy and cosy"),
  p("spicy", "Most romantic spot for a kiss:", "In the rain", "Under the stars"),
  p("spicy", "Turn up the romance with…", "Candles and music", "A slow dance at home"),
  p("spicy", "A secret signal for 'let's go home':", "A wink", "A squeeze of the hand"),
  p("spicy", "The best part of a cuddle:", "Big spoon", "Little spoon"),
  p("spicy", "Steal a kiss…", "In a crowded place", "When nobody's looking"),
  p("spicy", "Compliments that win me over:", "About my looks", "About my mind"),
];

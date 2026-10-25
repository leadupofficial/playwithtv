/**
 * Lantern Truths deck: each lantern holds a truth AND a dare; the actor picks which. `{P}` is the partner's
 * name. Dares are things two people can do on a sofa in front of the TV: no props, no leaving the room,
 * nothing that could embarrass someone outside the couple. Either partner can pass any card.
 * Spicy cards (18+) stay flirty and affectionate, never explicit.
 */
import type { Card } from "../kitcouple/engine";

const l = (tone: Card["tone"], truth: string, dare: string): Card => ({ kind: "lantern", tone, truth, dare });

export const DECK: Card[] = [
  // ---- sweet ----
  l("sweet", "What was the moment you knew you liked {P}?", "Give {P} three genuine compliments in a row"),
  l("sweet", "What's your favourite photo of the two of you, and why?", "Hold {P}'s hand and tell them one thing you're grateful for"),
  l("sweet", "What's one small thing {P} does that makes your day?", "Draw a heart on {P}'s palm with your finger"),
  l("sweet", "Where would you take {P} for a perfect day?", "Hum the song that reminds you of {P}"),
  l("sweet", "What's the kindest thing {P} has ever done for you?", "Give {P} a ten-second hug"),
  l("sweet", "What did you think of {P} the first time you met?", "Look into {P}'s eyes for 20 seconds without laughing"),
  l("sweet", "Which of {P}'s habits secretly makes you smile?", "Write {P}'s name on their arm with your fingertip, they guess the letters"),
  l("sweet", "What's a dream you'd love to share with {P}?", "Give {P} a forehead kiss"),
  l("sweet", "What song makes you think of {P}?", "Slow dance with {P} for one chorus, humming the tune"),
  l("sweet", "What are you most looking forward to with {P}?", "Make up a sweet nickname for {P} on the spot"),
  // ---- silly ----
  l("silly", "What's the silliest thing you've argued about with {P}?", "Do your best impression of {P} waking up"),
  l("silly", "What food would you never share with {P}?", "Propose to {P} again, as dramatically as possible"),
  l("silly", "What's your most embarrassing moment with {P}?", "Speak only in a pirate voice until your next turn"),
  l("silly", "If {P} were a cartoon character, who would they be?", "Give {P} a two-minute shoulder rub while narrating it like a sports commentator"),
  l("silly", "What's one weird habit of yours {P} has accepted?", "Serenade {P} with a made-up love song about their socks"),
  l("silly", "What's the worst gift you've ever been given?", "Do a runway walk across the room for {P}"),
  l("silly", "Which film couple are you and {P} most like?", "Act out how you two met, playing both parts"),
  l("silly", "What would {P}'s superhero name be?", "Make {P} laugh in under 30 seconds, no tickling"),
  l("silly", "What's the strangest thing you've Googled lately?", "Do your best robot dance for {P}"),
  l("silly", "What would you name our pet goldfish?", "Talk like a news reporter about your day with {P}"),
  // ---- deep ----
  l("deep", "What's something you've never told {P} but want to?", "Tell {P} one way they've helped you grow"),
  l("deep", "When do you feel closest to {P}?", "Hold {P}'s hands and say a promise for this year"),
  l("deep", "What's a fear you'd like {P} to help you with?", "Describe your favourite memory with {P} in detail"),
  l("deep", "What does home mean to you?", "Tell {P} what you admire most about them"),
  l("deep", "What's one thing you'd like us to do more often?", "Name three things {P} does that make you feel safe"),
  l("deep", "How do you want us to handle hard days?", "Share a goal and ask {P} how they can help"),
  l("deep", "What's a lesson your family taught you about love?", "Thank {P} for something you've never thanked them for"),
  l("deep", "When did you last feel really proud of {P}?", "Put your hand on {P}'s heart and stay quiet for 20 seconds"),
  l("deep", "What part of our story would you never change?", "Tell {P} where you picture the two of you in five years"),
  l("deep", "What do you need more of from {P}?", "Ask {P} what they need more of, and just listen"),
  // ---- spicy (18+, After Dark) ----
  l("spicy", "What's the most attractive thing about {P}?", "Whisper something flirty in {P}'s ear"),
  l("spicy", "Where was our most memorable kiss?", "Give {P} a slow kiss on the hand, then the cheek"),
  l("spicy", "What outfit of {P}'s do you love most?", "Give {P} a one-minute neck and shoulder massage"),
  l("spicy", "When did {P} last give you butterflies?", "Hold {P} close and slow dance for 30 seconds"),
  l("spicy", "What's your favourite way to be kissed?", "Kiss {P} somewhere they choose (keep it tasteful!)"),
  l("spicy", "What's a romantic date you've secretly wanted?", "Wink at {P} and deliver your best pick-up line"),
  l("spicy", "What's the flirtiest text you've sent {P}?", "Trace a slow line down {P}'s arm with one finger"),
  l("spicy", "What's one thing {P} does that you find irresistible?", "Give {P} the longest kiss you can without laughing"),
  l("spicy", "When do you think {P} looks their best?", "Sit in {P}'s lap until your next turn"),
  l("spicy", "What would your perfect night in with {P} look like?", "Describe your dream romantic getaway with {P} in a whisper"),
];

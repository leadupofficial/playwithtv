/**
 * Mind Match deck: "how well do you know me?" cards. `{S}` is replaced by the subject's name. The subject
 * picks their honest answer in secret, the partner guesses; a right guess fills a heart. 2 to 4 options,
 * short (they show on the phone buttons, ~26 characters).
 */
import type { Card } from "../kitcouple/engine";

const g = (tone: Card["tone"], prompt: string, ...options: string[]): Card => ({ kind: "guess", tone, prompt, options });

export const DECK: Card[] = [
  // ---- sweet ----
  g("sweet", "What makes {S} smile the most?", "A surprise", "A compliment", "A good laugh", "Cuddles"),
  g("sweet", "{S}'s favourite way to spend a date:", "Dinner out", "Movie night in", "An adventure", "A long walk"),
  g("sweet", "What would {S} pick as our song's mood?", "Romantic", "Upbeat", "Nostalgic"),
  g("sweet", "{S}'s ideal breakfast:", "Pancakes", "Eggs", "Fruit and yoghurt", "Just coffee"),
  g("sweet", "Which little gesture melts {S}?", "Forehead kiss", "Holding hands", "A love note", "Making them tea"),
  g("sweet", "What did {S} notice first about us?", "The eyes", "The smile", "The laugh", "The voice"),
  g("sweet", "{S}'s favourite season:", "Spring", "Summer", "Autumn", "Winter"),
  g("sweet", "How does {S} like to be comforted?", "A hug", "Kind words", "Space", "A treat"),
  g("sweet", "{S}'s dream holiday:", "Beach", "Mountains", "Big city", "Road trip"),
  g("sweet", "What would {S} save first in a fire?", "Photos", "A pet", "Phone", "A keepsake"),
  // ---- silly ----
  g("silly", "{S}'s go-to karaoke style:", "Power ballad", "Pop anthem", "Rap", "Refuses to sing"),
  g("silly", "Which animal is {S} most like?", "Cat", "Dog", "Owl", "Sloth"),
  g("silly", "{S}'s worst habit:", "Snoozing alarms", "Snacking at night", "Losing keys", "Being late"),
  g("silly", "In a zombie film, {S} would…", "Lead the group", "Hide in a cupboard", "Befriend a zombie"),
  g("silly", "{S}'s guilty pleasure:", "Reality TV", "Junk food", "Cheesy songs", "Online shopping"),
  g("silly", "How does {S} eat a pizza slice?", "Crust first", "Tip first", "Fold it", "Knife and fork"),
  g("silly", "{S} would rather fight…", "One horse-sized duck", "100 duck-sized horses"),
  g("silly", "What's {S} most likely to forget?", "Birthdays", "Where the car is", "Why they walked in", "Names"),
  g("silly", "{S}'s dance move of choice:", "The robot", "The sprinkler", "Dramatic twirl", "Just nodding"),
  g("silly", "If {S} had a theme song, it'd be…", "Heroic", "Funky", "Dramatic", "A lullaby"),
  // ---- deep ----
  g("deep", "What is {S} most proud of?", "Career", "Family", "Friendships", "Personal growth"),
  g("deep", "{S}'s biggest dream:", "Travel everywhere", "Build a family", "Start something", "Live peacefully"),
  g("deep", "When stressed, {S} usually…", "Goes quiet", "Talks it out", "Keeps busy", "Exercises"),
  g("deep", "What does {S} value most in us?", "Trust", "Fun", "Support", "Honesty"),
  g("deep", "{S}'s love language:", "Words", "Time together", "Gifts", "Touch", ),
  g("deep", "What scares {S} the most?", "Heights", "Being alone", "Failing", "Spiders"),
  g("deep", "{S} recharges best by…", "Being alone", "Seeing friends", "Being outdoors", "Sleeping"),
  g("deep", "Which memory of us does {S} treasure most?", "Our first date", "A trip together", "A quiet night", "A big laugh"),
  g("deep", "{S} would choose a life that's…", "Exciting", "Calm", "Meaningful", "Comfortable"),
  g("deep", "How does {S} show they care?", "Doing things", "Saying it", "Small gifts", "Being there"),
  // ---- spicy (18+, After Dark) ----
  g("spicy", "Where would {S} love a surprise kiss?", "Neck", "Hand", "Forehead", "Lips"),
  g("spicy", "{S} finds it most attractive when I…", "Dress up", "Make them laugh", "Take the lead", "Get flirty"),
  g("spicy", "{S}'s idea of a romantic night:", "Candlelit dinner", "Slow dancing", "Cuddling and a film", "A hotel getaway"),
  g("spicy", "What gives {S} butterflies?", "A look across the room", "A whisper", "A slow touch", "A flirty text"),
  g("spicy", "{S}'s favourite way to be held:", "From behind", "Face to face", "Hand in hand"),
  g("spicy", "Which outfit of mine does {S} like most?", "Dressed up", "Casual", "Sporty", "Pyjamas"),
  g("spicy", "{S} would most like a…", "Massage", "Bath for two", "Slow dance", "Long kiss"),
  g("spicy", "How flirty is {S} on a scale of…", "Shy", "A little", "Very", "Unstoppable"),
  g("spicy", "{S}'s first move would be…", "A wink", "A compliment", "Holding hands", "Going for the kiss"),
  g("spicy", "The best time for romance, says {S}:", "Morning", "Afternoon", "Evening", "Midnight"),
];

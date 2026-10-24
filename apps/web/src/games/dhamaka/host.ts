import type { QLang } from "../../content/trivia/types";

/**
 * The show's host: Kili, a loud parrot with a microphone (கிளி, "parrot" in Tamil; parrots famously repeat
 * everything, so Kili repeats the scores). Original lines; Tamil and Hindi to be checked by native speakers.
 */
export const HOST = { emoji: "🦜", name: { en: "Kili", ta: "கிளி", hi: "किली" } as Record<QLang, string> };

export type Moment =
  | "intro" | "emoji" | "mcq" | "order" | "final" | "right" | "wrong" | "steal" | "nobody" | "streak" | "comeback" | "board" | "podium";

const LINES: Record<QLang, Record<Moment, string[]>> = {
  en: {
    intro: ["Welcome to Emoji Dhamaka! I'm Kili, and I never forget a score!", "Phones out, fingers ready, snacks hidden!"],
    emoji: ["Fingers on buzzers!", "Emoji incoming… what's the title?", "First emoji is the most expensive one!"],
    mcq: ["Fact attack! Everyone answers.", "No buzzers this time: just brains and speed!"],
    order: ["Time machine! Oldest film first.", "Can you sort cinema history in seconds?"],
    final: ["Final round! Bet your points. Double or nothing!", "Big money, no whammies!"],
    right: ["Correct! Kili is impressed!", "Superb! Take a bow!", "Yes! The crowd goes wild!"],
    wrong: ["Ouch! That buzzer was a bit too brave.", "Oops! Steal time!", "Wrong! Somebody grab those points!"],
    steal: ["Daylight robbery!", "Steal! What a move!"],
    nobody: ["Nobody? Kili is shocked. Shocked!", "Even I knew that one!"],
    streak: ["On fire! Somebody call the fire brigade!", "Unstoppable!"],
    comeback: ["Comeback bonus! It's not over yet!", "Never give up: the underdog bites back!"],
    board: ["Let's see the scores!", "The leaderboard is shaking!"],
    podium: ["What a game! Give it up for everyone!", "Champions! Kili is crying happy tears."],
  },
  ta: {
    intro: ["எமோஜி தமாக்காவுக்கு வரவேற்கிறோம்! நான்தான் கிளி, எந்த ஸ்கோரும் மறக்க மாட்டேன்!", "போன் கையில், விரல் தயார், ஸ்நாக்ஸ் ஒளித்து வையுங்கள்!"],
    emoji: ["விரல்கள் பஸ்ஸரில்!", "எமோஜி வருகிறது… படம் என்ன?", "முதல் எமோஜிக்குத்தான் அதிக மதிப்பு!"],
    mcq: ["தகவல் தாக்குதல்! எல்லோரும் பதில் சொல்லுங்கள்.", "இந்த முறை பஸ்ஸர் இல்லை: மூளையும் வேகமும் மட்டும்!"],
    order: ["கால இயந்திரம்! பழைய படம் முதலில்.", "சினிமா வரலாற்றை நொடியில் வரிசைப்படுத்த முடியுமா?"],
    final: ["இறுதிச் சுற்று! புள்ளிகளைப் பந்தயம் கட்டுங்கள். இரட்டிப்பா, இழப்பா!", "பெரிய பந்தயம், பெரிய தைரியம்!"],
    right: ["சரி! கிளிக்கு ரொம்பப் பிடித்தது!", "அருமை! கை தட்டுங்கள்!", "ஆமாம்! கூட்டம் கொண்டாடுகிறது!"],
    wrong: ["அச்சச்சோ! கொஞ்சம் அவசரம்!", "தப்பு! பறிக்கும் நேரம்!", "தவறு! யாராவது புள்ளிகளைப் பறியுங்கள்!"],
    steal: ["பட்டப்பகல் கொள்ளை!", "பறித்தாச்சு! என்ன ஆட்டம்!"],
    nobody: ["யாருக்குமே தெரியவில்லையா? கிளி அதிர்ச்சியில்!", "எனக்கே தெரிந்ததே!"],
    streak: ["தீப்பிடிச்சாச்சு! தீயணைப்பு வண்டியைக் கூப்பிடுங்கள்!", "யாராலும் தடுக்க முடியாது!"],
    comeback: ["மீண்டு வரும் போனஸ்! ஆட்டம் இன்னும் முடியவில்லை!", "விட்டுக்கொடுக்காதீர்கள்!"],
    board: ["ஸ்கோரைப் பார்ப்போம்!", "புள்ளிப் பட்டியல் அதிர்கிறது!"],
    podium: ["என்ன ஒரு ஆட்டம்! எல்லோருக்கும் கைதட்டல்!", "சாம்பியன்கள்! கிளிக்கு ஆனந்தக் கண்ணீர்."],
  },
  hi: {
    intro: ["इमोजी धमाका में आपका स्वागत है! मैं किली हूँ, और मैं कोई स्कोर नहीं भूलता!", "फ़ोन हाथ में, उँगलियाँ तैयार, नाश्ता छुपा लीजिए!"],
    emoji: ["उँगलियाँ बज़र पर!", "इमोजी आ रहे हैं… नाम क्या है?", "पहला इमोजी सबसे क़ीमती है!"],
    mcq: ["फ़ैक्ट अटैक! सब जवाब दीजिए।", "इस बार बज़र नहीं: बस दिमाग़ और रफ़्तार!"],
    order: ["टाइम मशीन! सबसे पुरानी फ़िल्म पहले।", "क्या आप सिनेमा का इतिहास पलों में सजा सकते हैं?"],
    final: ["आख़िरी राउंड! अपने अंकों पर दाँव लगाइए। डबल या कुछ नहीं!", "बड़ा दाँव, बड़ा दिल!"],
    right: ["सही जवाब! किली ख़ुश हुआ!", "शानदार! तालियाँ!", "हाँ! भीड़ झूम उठी!"],
    wrong: ["उफ़! बज़र थोड़ा ज़्यादा बहादुर था।", "गलत! अब छीनने का समय!", "गलत! कोई तो ये अंक छीन लो!"],
    steal: ["दिन-दहाड़े डकैती!", "छीन लिया! क्या चाल है!"],
    nobody: ["किसी को नहीं पता? किली हैरान है!", "ये तो मुझे भी पता था!"],
    streak: ["आग लगा दी! फ़ायर ब्रिगेड बुलाओ!", "कोई नहीं रोक सकता!"],
    comeback: ["वापसी बोनस! खेल अभी बाक़ी है!", "हार मत मानो!"],
    board: ["चलो स्कोर देखते हैं!", "अंक तालिका हिल रही है!"],
    podium: ["क्या खेल था! सबके लिए तालियाँ!", "चैंपियन! किली की आँखों में ख़ुशी के आँसू।"],
  },
};

/** A line for this moment; `n` picks a variant so the host doesn't repeat itself every round. */
export function quip(lang: QLang, m: Moment, n: number): string {
  const list = LINES[lang][m];
  return list[Math.abs(n) % list.length]!;
}

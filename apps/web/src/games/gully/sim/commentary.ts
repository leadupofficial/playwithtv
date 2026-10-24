/**
 * Short, fun commentary lines in English, Tamil and Hindi. Each moment has a few variants; the TV shows the
 * English line with one of the other two underneath (alternating), like a local channel's ticker.
 */
export type Lang = "en" | "ta" | "hi";
export type Line = Record<Lang, string>;

export type Moment =
  | "six" | "roof" | "four" | "window" | "bowled" | "caught" | "caught-behind" | "one-bounce" | "runout" | "drop"
  | "miss" | "defend" | "dot" | "one" | "two" | "three" | "wide" | "innings" | "chase" | "tie" | "bowlout-hit"
  | "bowlout-miss" | "win" | "last-ball" | "perfect";

const L = (en: string, ta: string, hi: string): Line => ({ en, ta, hi });

export const LINES: Record<Moment, Line[]> = {
  six: [
    L("Out of the gully! SIX!", "சிக்ஸர்! தெருவைத் தாண்டி!", "छक्का! गली के बाहर!"),
    L("That's gone to the next street!", "பந்து அடுத்த தெருவுக்கு போச்சு!", "गेंद अगली गली में!"),
    L("Up, up and onto the balcony!", "நேரா பால்கனிக்கு!", "सीधा बालकनी पर!"),
  ],
  roof: [L("Over the rooftops! Lost ball, SIX!", "கூரைக்கு மேல! சிக்ஸர்!", "छत के पार! छक्का!")],
  four: [
    L("Past the sleeping dog — FOUR!", "தூங்குற நாயைத் தாண்டி நான்கு!", "सोते कुत्ते के पास से चौका!"),
    L("Along the ground, FOUR!", "தரையோடு நான்கு ரன்!", "ज़मीन पर चौका!"),
  ],
  window: [
    L("CRASH! Aunty's window! Bonus runs!", "டமால்! ஜன்னல் உடைஞ்சுது!", "धड़ाम! खिड़की टूट गई!"),
    L("Window smashed! Run before anyone comes out!", "ஜன்னல் போச்சு! ஓடுங்க!", "खिड़की गई! भागो!"),
  ],
  bowled: [
    L("Bowled! Bricks everywhere!", "போல்ட்! செங்கல் சிதறுது!", "बोल्ड! ईंटें बिखर गईं!"),
    L("Timber! The brick stack is down!", "செங்கல் விழுந்துடுச்சு!", "ईंटों का ढेर गिरा!"),
  ],
  caught: [
    L("Caught! Safe hands!", "கேட்ச்! நல்ல கை!", "कैच! पक्के हाथ!"),
    L("Taken! What a grab!", "அருமையான கேட்ச்!", "क्या कैच है!"),
  ],
  "caught-behind": [L("Edged and taken behind!", "எட்ஜ்! பின்னால கேட்ச்!", "किनारा लगा, पीछे कैच!")],
  "one-bounce": [L("One tip, one hand — OUT!", "ஒன் டிப் ஒன் ஹேண்ட் — அவுட்!", "एक टप्पा एक हाथ — आउट!")],
  runout: [L("Run out! Too greedy!", "ரன் அவுட்! பேராசை!", "रन आउट! लालच बुरी बला!")],
  drop: [L("Dropped! Butter fingers!", "கேட்ச் விட்டாச்சு!", "कैच छूट गया!")],
  miss: [
    L("Swing and a miss!", "பந்து தப்பிச்சுது!", "बल्ला घूमा, गेंद निकल गई!"),
    L("Beaten! Lovely ball.", "அழகான பந்து!", "शानदार गेंद!"),
  ],
  defend: [L("Solid defence.", "நல்ல தடுப்பு.", "बढ़िया डिफेंस।"), L("Blocked. No run.", "தடுத்தாச்சு.", "रोक दिया।")],
  dot: [L("Dot ball.", "ரன் இல்லை.", "कोई रन नहीं।")],
  one: [L("Quick single!", "ஒரு ரன்!", "एक रन!")],
  two: [L("They come back for two!", "இரண்டு ரன்!", "दो रन!")],
  three: [L("Three! Great running!", "மூன்று ரன்! சூப்பர் ஓட்டம்!", "तीन रन! शानदार दौड़!")],
  wide: [L("Wide! Free run!", "வைட்! இலவச ரன்!", "वाइड! मुफ़्त रन!")],
  innings: [L("Gully Super Over! Let's play!", "கல்லி சூப்பர் ஓவர்! ஆரம்பம்!", "गली सुपर ओवर! शुरू करो!")],
  chase: [L("The chase is on!", "சேஸ் ஆரம்பம்!", "पीछा शुरू!")],
  tie: [L("All square! Bowl-out!", "சமநிலை! போல்-அவுட்!", "बराबरी! बॉल-आउट!")],
  "bowlout-hit": [L("Bricks down! Bullseye!", "குறி தப்பல!", "निशाना सही!")],
  "bowlout-miss": [L("Missed the bricks!", "தவறிப்போச்சு!", "चूक गए!")],
  win: [L("What a finish!", "என்ன ஒரு முடிவு!", "क्या शानदार अंत!")],
  "last-ball": [L("Last ball! Everything on this!", "கடைசி பந்து!", "आख़िरी गेंद!")],
  perfect: [L("Sweet as a jalebi!", "சூப்பர் டைமிங்!", "मीठी टाइमिंग!")],
};

/** Picks a line for a moment; `n` (e.g. the ball number) chooses the variant and which Indian language shows. */
export function commentary(m: Moment, n: number): { en: string; sub: string; lang: "ta" | "hi" } {
  const options = LINES[m];
  const line = options[Math.abs(n) % options.length]!;
  const lang = n % 2 === 0 ? "ta" : "hi";
  return { en: line.en, sub: line[lang], lang };
}

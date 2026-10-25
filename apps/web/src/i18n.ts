/**
 * UI text for the motion controller, the calibration/practice screen and the motion games.
 * English is the source; Tamil and Hindi are first translations and should be reviewed by native speakers.
 * Pick with ?lang=ta, a saved choice, or the device language. Missing keys fall back to English.
 */
export type Lang = "en" | "ta" | "hi";
export const LANGS: Record<Lang, string> = { en: "English", ta: "தமிழ்", hi: "हिन्दी" };

const en = {
  "ctl.watchTv": "Watch the TV",
  "ctl.start": "Tap to start your controller",
  "ctl.startHint": "Motion controls: move the phone, keep your eyes on the TV",
  "ctl.noSensors": "This browser can't read motion sensors. Open the link in Chrome (Android) or Safari (iPhone).",
  "ctl.denied": "Motion access was blocked. On iPhone: Settings → Safari → Motion & Orientation Access, then reload.",
  "ctl.calibrate": "Hold your phone the way you'll play and keep still…",
  "ctl.calibrated": "Ready! Keep holding it like this",
  "ctl.recentre": "Re-centre",
  "ctl.leave": "Leave",
  "ctl.stale": "Motion sensors paused. Tap to restart them.",
  "ctl.rotate": "Turn your phone sideways",
  "ctl.rotateHint": "Hold it in landscape and keep your eyes on the TV.",
  "ctl.sensitivity": "Sensitivity",
  "install.title": "Install the app",
  "install.phone": "Install Play With TV: one tap next time, full screen, no app store.",
  "install.ios": "Install: tap Share ⬆︎ at the bottom, then “Add to Home Screen”.",
  "install.inApp": "To install, open this link in Chrome or Safari (menu ⋮ → Open in browser).",
  "install.firefox": "To install: menu ⋮ → Install.",
  "install.button": "Install",
  "install.later": "Not now",
  "install.tvButton": "Install TV app",
  "install.tvSave": "Save this page",
  "install.tvBookmark": "This TV browser can't install apps. Add this page to its bookmarks (or pin it to the home screen) so it's one click next time.",
  "ctl.wake": "This phone may turn its screen off while you play. Set Screen timeout to 10 minutes (Settings → Display) or turn off battery saver.",
  "ctl.wifi": "📶 Slow link ({ms} ms). For lag-free play, connect this phone to the same Wi-Fi as the TV (not mobile data). Already on it? Guest Wi-Fi can block phones from the TV: use the main network.",
  "ctl.wifiOk": "Got it",
  "tut.title": "Get ready: practise the moves",
  "tut.hold": "Hold your phone steady to calibrate",
  "tut.ready": "Calibrated",
  "tut.try": "Try it",
  "tut.starting": "Starting in {n}…",
  "tut.skip": "Press OK on the remote to start now",
  "tut.noSensor": "Waiting for motion…",
  "motion.tilt": "Tilt",
  "motion.roll": "Turn like a steering wheel",
  "motion.pitch": "Tip forward / back",
  "motion.yaw": "Turn left / right",
  "motion.push": "Push towards the TV",
  "motion.pull": "Pull towards you",
  "motion.flick-up": "Flick up",
  "motion.flick-down": "Flick down",
  "motion.flick-left": "Flick left",
  "motion.flick-right": "Flick right",
  "motion.twist-left": "Twist left",
  "motion.twist-right": "Twist right",
  "motion.shake": "Shake",
  "maze.level": "Level {n}",
  "maze.turn": "{name}'s turn",
  "maze.goal": "Roll the ball into the glowing goal",
  "maze.fell": "Fell in! Back to the checkpoint",
  "maze.checkpoint": "Checkpoint",
  "maze.done": "Level complete!",
  "racer.lap": "Gate {n} / {total}",
  "racer.boost": "BOOST",
  "racer.finish": "Finished!",
  "racer.go": "GO!",
};
type Key = keyof typeof en;

const ta: Partial<Record<Key, string>> = {
  "ctl.watchTv": "டிவியைப் பாருங்கள்",
  "ctl.start": "கண்ட்ரோலரைத் தொடங்க தொடவும்",
  "ctl.startHint": "மோஷன் கட்டுப்பாடு: போனை அசைத்து, டிவியைப் பாருங்கள்",
  "ctl.calibrate": "விளையாடும் விதத்தில் போனைப் பிடித்து அசையாமல் வைத்திருங்கள்…",
  "ctl.calibrated": "தயார்! இப்படியே பிடித்திருங்கள்",
  "ctl.recentre": "மீண்டும் மையப்படுத்து",
  "ctl.leave": "வெளியேறு",
  "install.phone": "Play With TV-ஐ நிறுவுங்கள்: அடுத்த முறை ஒரே தொடுதல், முழுத் திரை, ஆப் ஸ்டோர் தேவையில்லை.",
  "install.ios": "நிறுவ: கீழே Share ⬆︎ தொட்டு, “Add to Home Screen” தேர்வு செய்யுங்கள்.",
  "install.button": "நிறுவு",
  "install.later": "பிறகு",
  "ctl.wake": "விளையாடும்போது திரை அணையலாம். Settings → Display-ல் Screen timeout-ஐ 10 நிமிடமாக்குங்கள் அல்லது battery saver-ஐ அணையுங்கள்.",
  "ctl.wifi": "📶 இணைப்பு மெதுவாக உள்ளது ({ms} ms). தாமதமின்றி விளையாட, இந்த போனை டிவி இணைந்துள்ள அதே Wi-Fi-யில் இணையுங்கள் (மொபைல் டேட்டா வேண்டாம்). Guest Wi-Fi-யில் இருந்தால் முக்கிய Wi-Fi-க்கு மாறுங்கள்.",
  "ctl.wifiOk": "சரி",
  "ctl.rotate": "போனைப் பக்கவாட்டில் திருப்புங்கள்",
  "tut.title": "தயாராகுங்கள்: அசைவுகளைப் பயிற்சி செய்யுங்கள்",
  "tut.ready": "தயார்",
  "tut.try": "முயற்சி செய்யுங்கள்",
  "tut.starting": "{n} வினாடிகளில் தொடங்கும்…",
  "motion.roll": "ஸ்டீயரிங் போல் திருப்புங்கள்",
  "motion.push": "டிவியை நோக்கித் தள்ளுங்கள்",
  "motion.shake": "குலுக்குங்கள்",
  "maze.level": "நிலை {n}",
  "maze.done": "நிலை முடிந்தது!",
  "racer.finish": "முடித்தீர்கள்!",
};

const hi: Partial<Record<Key, string>> = {
  "ctl.watchTv": "टीवी देखिए",
  "ctl.start": "कंट्रोलर शुरू करने के लिए टैप करें",
  "ctl.startHint": "मोशन कंट्रोल: फ़ोन हिलाइए, नज़र टीवी पर रखिए",
  "ctl.calibrate": "फ़ोन को वैसे पकड़ें जैसे खेलेंगे और स्थिर रखें…",
  "ctl.calibrated": "तैयार! ऐसे ही पकड़े रहें",
  "ctl.recentre": "फिर से सेंटर करें",
  "ctl.leave": "छोड़ें",
  "install.phone": "Play With TV इंस्टॉल करें: अगली बार एक टैप, फ़ुल स्क्रीन, ऐप स्टोर की ज़रूरत नहीं।",
  "install.ios": "इंस्टॉल करने के लिए: नीचे Share ⬆︎ दबाएँ, फिर “Add to Home Screen”।",
  "install.button": "इंस्टॉल करें",
  "install.later": "अभी नहीं",
  "ctl.wake": "खेलते समय स्क्रीन बंद हो सकती है। Settings → Display में Screen timeout 10 मिनट करें या battery saver बंद करें।",
  "ctl.wifi": "📶 कनेक्शन धीमा है ({ms} ms)। बिना लैग के खेलने के लिए इस फ़ोन को उसी Wi-Fi से जोड़ें जिससे TV जुड़ा है (मोबाइल डेटा नहीं)। Guest Wi-Fi पर हैं तो मुख्य Wi-Fi चुनें।",
  "ctl.wifiOk": "ठीक है",
  "ctl.rotate": "फ़ोन को आड़ा कीजिए",
  "tut.title": "तैयार हो जाइए: मूव्स का अभ्यास करें",
  "tut.ready": "तैयार",
  "tut.try": "आज़माइए",
  "tut.starting": "{n} में शुरू…",
  "motion.roll": "स्टीयरिंग की तरह घुमाइए",
  "motion.push": "टीवी की ओर धकेलिए",
  "motion.shake": "हिलाइए",
  "maze.level": "लेवल {n}",
  "maze.done": "लेवल पूरा!",
  "racer.finish": "पूरा हुआ!",
};

const DICTS: Record<Lang, Partial<Record<Key, string>>> = { en, ta, hi };

export function currentLang(): Lang {
  try {
    const q = new URLSearchParams(location.search).get("lang");
    const saved = localStorage.getItem("pwtv.lang");
    const pick = (q ?? saved ?? navigator.language.slice(0, 2)) as Lang;
    if (q && q in LANGS) localStorage.setItem("pwtv.lang", q);
    return pick in LANGS ? pick : "en";
  } catch {
    return "en";
  }
}

const lang = currentLang();

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  const s = DICTS[lang][key] ?? en[key];
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

export type TextKey = Key;

// The TV pages install as the TV app; everything else as the phone controller (an external file: the CSP allows no inline scripts).
if (/^\/(tv|play)\b/.test(location.pathname)) document.getElementById("app-manifest").href = "/manifest-tv.webmanifest";

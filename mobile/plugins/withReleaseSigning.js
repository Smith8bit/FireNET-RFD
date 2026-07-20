const { withAppBuildGradle } = require("expo/config-plugins");

// Prebuild regenerates android/app/build.gradle from the Expo template, which
// signs the *release* build with the throwaway debug keystore. The sideloaded
// in-app updater needs a STABLE production key across releases (Android rejects
// an over-the-top install signed by a different key), so this plugin rewrites
// the release build to sign with a keystore supplied via Gradle properties:
//
//   FIRENET_UPLOAD_STORE_FILE      absolute path to the .keystore
//   FIRENET_UPLOAD_STORE_PASSWORD
//   FIRENET_UPLOAD_KEY_ALIAS
//   FIRENET_UPLOAD_KEY_PASSWORD
//
// Keep those OUT of the repo — put them in ~/.gradle/gradle.properties (global,
// outside the project) or pass them as -P flags / CI secrets. When they are
// absent, release falls back to the debug key so ordinary dev builds still work.
const RELEASE_SIGNING_CONFIG = `        release {
            if (project.hasProperty('FIRENET_UPLOAD_STORE_FILE')) {
                storeFile file(FIRENET_UPLOAD_STORE_FILE)
                storePassword FIRENET_UPLOAD_STORE_PASSWORD
                keyAlias FIRENET_UPLOAD_KEY_ALIAS
                keyPassword FIRENET_UPLOAD_KEY_PASSWORD
            }
        }`;

const RELEASE_SIGNING_EXPR =
  "signingConfig project.hasProperty('FIRENET_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug";

/**
 * Rewrite a groovy build.gradle to add a `release` signing config and point the
 * release build type at it (falling back to debug when unconfigured). Pure and
 * idempotent so it's safe to unit-test and to re-run across prebuilds.
 * @param {string} src - build.gradle contents.
 * @returns {string} the transformed contents (unchanged if anchors aren't found).
 */
function transform(src) {
  if (!src.includes("FIRENET_UPLOAD_STORE_FILE")) {
    // Append the release signing config right after the debug one. The debug
    // config's last line is a stable anchor in the Expo template.
    const anchor = /keyPassword 'android'\s*\n\s*\}/;
    if (anchor.test(src)) {
      src = src.replace(anchor, (m) => `${m}\n${RELEASE_SIGNING_CONFIG}`);
    }
  }
  if (!src.includes(RELEASE_SIGNING_EXPR)) {
    // The release build type is the LAST `signingConfig signingConfigs.debug`
    // (the first belongs to the debug build type; the release signing config
    // added above references the FIRENET_* props, not this literal).
    const needle = "signingConfig signingConfigs.debug";
    const last = src.lastIndexOf(needle);
    if (last !== -1) {
      src = src.slice(0, last) + RELEASE_SIGNING_EXPR + src.slice(last + needle.length);
    }
  }
  return src;
}

module.exports = (config) =>
  withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language === "groovy") {
      cfg.modResults.contents = transform(cfg.modResults.contents);
    }
    return cfg;
  });

// Exported for the transform unit test; not used by Expo at prebuild time.
module.exports.transform = transform;

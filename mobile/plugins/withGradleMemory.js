const { withGradleProperties } = require("expo/config-plugins");

// ponytail: prebuild regenerates android/gradle.properties, so set jvmargs here
// instead. Bump if release builds still OOM on metaspace.
const JVM_ARGS = "-Xmx4096m -XX:MaxMetaspaceSize=1024m";

module.exports = (config) =>
  withGradleProperties(config, (cfg) => {
    const props = cfg.modResults;
    const existing = props.find(
      (p) => p.type === "property" && p.key === "org.gradle.jvmargs",
    );
    if (existing) existing.value = JVM_ARGS;
    else props.push({ type: "property", key: "org.gradle.jvmargs", value: JVM_ARGS });
    return cfg;
  });

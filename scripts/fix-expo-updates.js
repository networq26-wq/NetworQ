const fs = require("fs");
const path = require("path");

function removeOptimizedRecord(filePath) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, "utf8");
  if (content.includes("OptimizedRecord")) {
    content = content.replace(/import expo\.modules\.kotlin\.types\.OptimizedRecord\n?/g, "");
    content = content.replace(/@OptimizedRecord\n?/g, "");
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`[fix-expo-updates] Cleaned OptimizedRecord from ${path.basename(filePath)}`);
  }
}

const updatesModule = path.join(
  __dirname,
  "../node_modules/expo-updates/android/src/main/java/expo/modules/updates/UpdatesModule.kt"
);
const reloadScreen = path.join(
  __dirname,
  "../node_modules/expo-updates/android/src/main/java/expo/modules/updates/reloadscreen/ReloadScreenConfiguration.kt"
);

removeOptimizedRecord(updatesModule);
removeOptimizedRecord(reloadScreen);

module.exports = {
  forbidden: [{
    name: "no-circular-dependencies",
    severity: "error",
    from: {},
    to: { circular: true },
  }],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { extensions: [".js", ".ts", ".vue", ".json"] },
  },
};

// ==UserScript==
// @name         BM Client for Blueberry Playground
// @namespace    beech-marten-council
// @version      1.0
// @description  Build + test tools for Blueberry Playground (Beech Marten Council)
// @match        https://d3rtzzzsiu7gdr.cloudfront.net/files/blueberry/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function () {
  var BASE = 'https://glassifying.github.io/bm-client/';
  var s = document.createElement('script');
  s.src = BASE + 'client.js?t=' + Date.now();
  document.body.appendChild(s);
})();

// Ihned (ještě než se stihne načíst hlavní app.js) nastaví správnou stránku podle URL,
// ať se při tvrdém obnovení stránky na zlomek vteřiny nemihne domovská stránka.
(function(){
  var seg = location.hash.replace(/^#/, '').split('/')[0];
  var el = seg ? document.getElementById('view-' + seg) : null;
  if(!el) el = document.getElementById('view-home');
  el.classList.add('active');
  var navName = (seg === 'event') ? 'akce' : seg;
  var nav = navName ? document.querySelector('.nav-item[data-view="' + navName + '"]') : null;
  if(nav) nav.classList.add('active');
})();

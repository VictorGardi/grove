// The outline beside wide markdown artifacts (renderOutline). Frame navigation is guarded,
// so links scroll in place instead of following `#id`; the link of the section in view is marked active.
(function () {
  var nav = document.querySelector('nav.toc')
  if (!nav) return
  var links = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]'))
  var targets = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)) })
  var active = null

  nav.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#"]')
    if (!a) return
    e.preventDefault()
    var h = targets[links.indexOf(a)]
    if (h) h.scrollIntoView({ block: 'start', behavior: 'smooth' })
  })

  // The last heading above the top quarter of the frame owns the view.
  function update() {
    var line = innerHeight / 4
    var current = 0
    for (var i = 0; i < targets.length; i++) if (targets[i] && targets[i].getBoundingClientRect().top <= line) current = i
    var link = links[current]
    if (link === active) return
    if (active) active.classList.remove('active')
    if (link) link.classList.add('active')
    active = link
  }

  var queued = false
  addEventListener('scroll', function () {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; update() })
  }, { passive: true })
  addEventListener('resize', update)
  update()
})()

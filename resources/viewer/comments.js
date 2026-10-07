// Comment support for markdown artifacts (ADR 0026). Talks to the app only over postMessage:
//   → app  {grove:1, type:'ready'} | {type:'select', exact, prefix, suffix, start, end} | {type:'open', id}
//   ← app  {grove:1, type:'config', canComment} | {type:'highlights', items:[{id, exact, prefix, suffix}]} | {type:'reveal', id}
// Highlights use CSS.highlights, so the DOM is never changed.
(function () {
  var CONTEXT = 40
  var canComment = false
  var items = []
  var ranges = [] // [{ id, range }]
  var pop = null
  var pending = null

  function post(msg) {
    msg.grove = 1
    parent.postMessage(msg, '*')
  }

  // The rendered text with whitespace collapsed and a space between blocks, and where each char came from.
  function index() {
    var root = document.querySelector('main') || document.body
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    var chars = [] // {node, off}
    var nodes = [] // {node, map}
    var text = ''
    var lastBlock = null
    for (var n = walker.nextNode(); n; n = walker.nextNode()) {
      var el = n.parentElement
      if (!el || el.closest('script,style,.grove-pop')) continue
      var block = el.closest('p,li,h1,h2,h3,h4,h5,h6,pre,td,th,blockquote,tr,table') || root
      var value = n.nodeValue
      var map = new Array(value.length + 1)
      for (var i = 0; i < value.length; i++) {
        var ws = /\s/.test(value[i])
        map[i] = text.length
        if (lastBlock !== null && block !== lastBlock && text.length && text[text.length - 1] !== ' ') {
          text += ' '
          chars.push({ node: n, off: i })
          map[i] = text.length
        }
        lastBlock = block
        if (ws) {
          if (text.length && text[text.length - 1] !== ' ') {
            text += ' '
            chars.push({ node: n, off: i })
          }
        } else {
          text += value[i]
          chars.push({ node: n, off: i })
        }
      }
      map[value.length] = text.length
      nodes.push({ node: n, map: map })
    }
    return { text: text, chars: chars, nodes: nodes }
  }

  function boundary(ix, container, offset, isEnd) {
    if (container.nodeType === 3) {
      for (var i = 0; i < ix.nodes.length; i++) if (ix.nodes[i].node === container) return ix.nodes[i].map[offset]
    }
    var r = document.createRange()
    r.setStart(container, offset)
    r.collapse(true)
    if (!isEnd) {
      for (var a = 0; a < ix.nodes.length; a++) if (r.comparePoint(ix.nodes[a].node, 0) >= 0) return ix.nodes[a].map[0]
      return ix.text.length
    }
    for (var b = ix.nodes.length - 1; b >= 0; b--) {
      var nd = ix.nodes[b]
      if (r.comparePoint(nd.node, nd.node.nodeValue.length) <= 0) return nd.map[nd.node.nodeValue.length]
    }
    return 0
  }

  function lineOf(node, last) {
    var el = node.nodeType === 1 ? node : node.parentElement
    var holder = el && el.closest('[data-line]')
    if (!holder) return null
    var parts = holder.getAttribute('data-line').split('-')
    return Number(parts[last ? 1 : 0])
  }

  function selection() {
    var sel = getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
    var range = sel.getRangeAt(0)
    var ix = index()
    var a = boundary(ix, range.startContainer, range.startOffset, false)
    var b = boundary(ix, range.endContainer, range.endOffset, true)
    var raw = ix.text.slice(a, b)
    var exact = raw.trim()
    if (!exact) return null
    a += raw.indexOf(exact)
    b = a + exact.length
    var start = lineOf(range.startContainer, false)
    var end = lineOf(range.endContainer, true)
    if (start === null || end === null) return null
    return {
      range: range,
      exact: exact,
      prefix: ix.text.slice(Math.max(0, a - CONTEXT), a),
      suffix: ix.text.slice(b, b + CONTEXT),
      start: Math.min(start, end),
      end: Math.max(start, end),
    }
  }

  function hidePop() {
    if (pop) pop.remove()
    pop = null
    pending = null
  }

  function showPop() {
    var sel = selection()
    if (!sel) return hidePop()
    pending = sel
    if (!pop) {
      pop = document.createElement('div')
      pop.className = 'grove-pop'
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = 'Comment'
      btn.addEventListener('mousedown', function (e) { e.preventDefault() })
      btn.addEventListener('click', function () {
        if (!pending || !canComment) return
        post({ type: 'select', exact: pending.exact, prefix: pending.prefix, suffix: pending.suffix, start: pending.start, end: pending.end })
        getSelection().removeAllRanges()
        hidePop()
      })
      pop.appendChild(btn)
      document.body.appendChild(pop)
    }
    pop.firstChild.disabled = !canComment
    pop.firstChild.title = canComment ? '' : 'Focus a session to comment'
    var rect = sel.range.getBoundingClientRect()
    pop.style.top = rect.bottom + window.scrollY + 6 + 'px'
    pop.style.left = Math.max(8, Math.min(rect.right + window.scrollX - 60, document.documentElement.clientWidth - 110)) + 'px'
  }

  // The range of `prefix+exact+suffix`, else of `exact`.
  function locate(ix, it) {
    var at = it.prefix || it.suffix ? ix.text.indexOf(it.prefix + it.exact + it.suffix) : -1
    var from
    if (at >= 0) from = at + it.prefix.length
    else from = ix.text.indexOf(it.exact)
    if (from < 0 || !it.exact) return null
    var first = ix.chars[from]
    var last = ix.chars[from + it.exact.length - 1]
    if (!first || !last) return null
    var r = document.createRange()
    r.setStart(first.node, first.off)
    r.setEnd(last.node, last.off + 1)
    return r
  }

  function draw() {
    var ix = index()
    ranges = []
    items.forEach(function (it) {
      var r = locate(ix, it)
      if (r) ranges.push({ id: it.id, range: r })
    })
    if (window.CSS && CSS.highlights && typeof Highlight === 'function') {
      CSS.highlights.delete('grove-comment')
      if (ranges.length) CSS.highlights.set('grove-comment', new Highlight(...ranges.map(function (x) { return x.range })))
    }
  }

  function hit(e) {
    var pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(e.clientX, e.clientY) : null
    var node, off
    if (pos) { node = pos.offsetNode; off = pos.offset } else if (document.caretRangeFromPoint) {
      var cr = document.caretRangeFromPoint(e.clientX, e.clientY)
      if (!cr) return null
      node = cr.startContainer; off = cr.startOffset
    } else return null
    for (var i = 0; i < ranges.length; i++) {
      var r = ranges[i].range
      try {
        if (r.comparePoint(node, off) === 0) return ranges[i].id
      } catch (err) { /* detached */ }
    }
    return null
  }

  document.addEventListener('mouseup', function (e) {
    if (pop && pop.contains(e.target)) return
    setTimeout(function () {
      var sel = getSelection()
      if (sel && !sel.isCollapsed) return showPop()
      hidePop()
      var id = hit(e)
      if (id) post({ type: 'open', id: id })
    }, 0)
  })
  document.addEventListener('keyup', function (e) {
    if (e.key === 'Shift' || e.key.indexOf('Arrow') === 0) showPop()
  })

  window.addEventListener('message', function (e) {
    if (e.source !== parent) return
    var m = e.data
    if (!m || m.grove !== 1) return
    if (m.type === 'config') {
      canComment = m.canComment === true
      if (pop) pop.firstChild.disabled = !canComment
    } else if (m.type === 'highlights' && Array.isArray(m.items)) {
      items = m.items.filter(function (x) { return x && typeof x.id === 'string' && typeof x.exact === 'string' })
        .map(function (x) { return { id: x.id, exact: x.exact, prefix: String(x.prefix || ''), suffix: String(x.suffix || '') } })
      draw()
    } else if (m.type === 'reveal') {
      var found = ranges.filter(function (x) { return x.id === m.id })[0]
      if (found) found.range.startContainer.parentElement.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  })

  post({ type: 'ready' })
})()

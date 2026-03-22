// Nav toggle (mobile)
const toggle = document.getElementById('navToggle');
const nav = document.getElementById('siteNav');

if (toggle && nav) {
  toggle.addEventListener('click', () => {
    nav.classList.toggle('open');
    toggle.textContent = nav.classList.contains('open') ? '[close]' : '[menu]';
  });
}

// Close nav on outside click
document.addEventListener('click', (e) => {
  if (nav && toggle && !nav.contains(e.target) && !toggle.contains(e.target)) {
    nav.classList.remove('open');
    toggle.textContent = '[menu]';
  }
});

// Close nav on resize
window.addEventListener('resize', () => {
  if (window.innerWidth > 600 && nav) {
    nav.classList.remove('open');
  }
});

// Active nav link highlight for nested paths
document.querySelectorAll('.site-nav a').forEach(link => {
  const linkPath = new URL(link.href, window.location.origin).pathname;
  const currentPath = window.location.pathname;
  if (currentPath.startsWith(linkPath) && linkPath !== '/') {
    link.classList.add('active');
  }
});

// Code block copy button
document.querySelectorAll('pre').forEach(block => {
  const btn = document.createElement('button');
  btn.textContent = 'copy';
  btn.style.cssText = `
    position: absolute;
    top: 8px;
    right: 8px;
    background: none;
    border: 1px solid #222;
    color: #555;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.06em;
    padding: 3px 8px;
    cursor: pointer;
    transition: all 0.2s;
  `;
  btn.addEventListener('mouseenter', () => {
    btn.style.borderColor = '#c8a96e';
    btn.style.color = '#c8a96e';
  });
  btn.addEventListener('mouseleave', () => {
    if (btn.textContent !== 'copied') {
      btn.style.borderColor = '#222';
      btn.style.color = '#555';
    }
  });
  btn.addEventListener('click', () => {
    const code = block.querySelector('code');
    if (code) {
      navigator.clipboard.writeText(code.textContent).then(() => {
        btn.textContent = 'copied';
        btn.style.color = '#c8a96e';
        setTimeout(() => {
          btn.textContent = 'copy';
          btn.style.color = '#555';
          btn.style.borderColor = '#222';
        }, 2000);
      });
    }
  });

  block.style.position = 'relative';
  block.appendChild(btn);
});

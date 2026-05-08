// 简洁的导航高亮 — 用 IntersectionObserver 跟踪当前 section
(() => {
  const navLinks = Array.from(document.querySelectorAll(".primary-nav a"));
  const sections = navLinks
    .map(link => {
      const id = link.getAttribute("href");
      if (!id || !id.startsWith("#")) return null;
      const target = document.querySelector(id);
      return target ? { link, target } : null;
    })
    .filter(Boolean);

  if (sections.length === 0) return;

  const linkByTarget = new Map(sections.map(({ link, target }) => [target, link]));
  let activeLink = null;

  const setActive = link => {
    if (activeLink === link) return;
    if (activeLink) activeLink.classList.remove("is-active");
    activeLink = link;
    if (activeLink) activeLink.classList.add("is-active");
  };

  const observer = new IntersectionObserver(
    entries => {
      // 取最靠近视口顶部、可见比例最高的一段作为当前 section
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visible.length > 0) {
        const link = linkByTarget.get(visible[0].target);
        if (link) setActive(link);
      }
    },
    {
      rootMargin: "-30% 0px -55% 0px",
      threshold: [0, 0.25, 0.5, 0.75, 1],
    },
  );

  for (const { target } of sections) {
    observer.observe(target);
  }

  // 默认高亮首页
  setActive(navLinks[0]);
})();

<script lang="ts">
  import { onMount } from "svelte";

  const balconyWaiting = "/in-grandmas-white-hair-i-saw-time/balcony-grandma-waiting.webp";
  const balconyApproaching = "/in-grandmas-white-hair-i-saw-time/balcony-sitting.webp";
  const balconyTogether = "/in-grandmas-white-hair-i-saw-time/balcony-relaxed.webp";
  const balconySunset = "/in-grandmas-white-hair-i-saw-time/balcony-relaxed-sunset.webp";
  const balconyEmpty = "/in-grandmas-white-hair-i-saw-time/balcony-empty-blue-hour.webp";
  const grandmaMemory = "/in-grandmas-white-hair-i-saw-time/grandma-memory.webp";
  const grandmaHair = "/in-grandmas-white-hair-i-saw-time/grandma-hair.webp";
  const deskDay = "/in-grandmas-white-hair-i-saw-time/desk-day-v2.webp";
  const deskDusk = "/in-grandmas-white-hair-i-saw-time/desk-dusk-v2.webp";
  const deskNight = "/in-grandmas-white-hair-i-saw-time/desk-night-v2.webp";

  let filmRoot: HTMLElement;
  let plainTextMode = false;
  let isSmallDevice = false;
  let mobileNoticeVisible = false;
  let mobileNoticeTimer: ReturnType<typeof setTimeout> | undefined;
  let tocRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  const refreshArticleToc = () => {
    if (typeof window === "undefined") return;
    if (tocRefreshTimer) clearTimeout(tocRefreshTimer);
    tocRefreshTimer = setTimeout(() => {
      window.dispatchEvent(new CustomEvent("article-toc-refresh"));
      tocRefreshTimer = undefined;
    }, 0);
  };

  const showMobileNotice = () => {
    mobileNoticeVisible = true;
    if (mobileNoticeTimer) clearTimeout(mobileNoticeTimer);
    mobileNoticeTimer = setTimeout(() => {
      mobileNoticeVisible = false;
      mobileNoticeTimer = undefined;
    }, 2600);
  };

  const toggleTextMode = () => {
    if (isSmallDevice && plainTextMode) {
      showMobileNotice();
      return;
    }

    plainTextMode = !plainTextMode;
    mobileNoticeVisible = false;
    refreshArticleToc();
  };

  onMount(() => {
    if (!filmRoot) return;

    const smallDeviceQuery = window.matchMedia("(max-width: 767px)");
    const syncViewportMode = () => {
      isSmallDevice = smallDeviceQuery.matches;
      if (isSmallDevice) {
        plainTextMode = true;
        mobileNoticeVisible = false;
      }
      refreshArticleToc();
    };

    syncViewportMode();

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const revealTargets = Array.from(
      filmRoot.querySelectorAll<HTMLElement>("[data-film-reveal]"),
    );
    const scenes = Array.from(
      filmRoot.querySelectorAll<HTMLElement>("[data-film-scene]"),
    );
    const balconyScene = filmRoot.querySelector<HTMLElement>(".grandma-film__scene--balcony");
    const deskScene = filmRoot.querySelector<HTMLElement>(".grandma-film__scene--desk");
    const endingScene = filmRoot.querySelector<HTMLElement>(".grandma-film__scene--ending");
    const endingCopyTargets = Array.from(
      filmRoot.querySelectorAll<HTMLElement>("[data-ending-copy]"),
    );
    const dialogueLines = Array.from(
      filmRoot.querySelectorAll<HTMLElement>("[data-film-dialogue-line]"),
    );

    filmRoot.dataset.filmReady = "true";

    const cleanups: Array<() => void> = [];
    smallDeviceQuery.addEventListener("change", syncViewportMode);
    cleanups.push(() => smallDeviceQuery.removeEventListener("change", syncViewportMode));
    cleanups.push(() => {
      if (mobileNoticeTimer) clearTimeout(mobileNoticeTimer);
      if (tocRefreshTimer) clearTimeout(tocRefreshTimer);
    });
    let scrollFrame = 0;

    const clamp = (value: number, min = 0, max = 1) =>
      Math.min(Math.max(value, min), max);

    const easeInOut = (value: number) => {
      const t = clamp(value);
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    };

    const updateEndingCopy = (progress: number) => {
      if (reducedMotion) {
        endingCopyTargets.forEach((target) => {
          target.style.setProperty("--ending-copy-opacity", "1");
          target.style.setProperty("--ending-copy-y", "0rem");
          target.style.setProperty("--ending-copy-blur", "0rem");
          target.style.setProperty("--ending-copy-scale", "1");
        });
        return;
      }

      const fadeWindow = 0.07;

      endingCopyTargets.forEach((target) => {
        const start = Number(target.dataset.endingStart ?? 0);
        const fadeIn = easeInOut((progress - start) / fadeWindow);
        const opacity = fadeIn;

        target.style.setProperty("--ending-copy-opacity", opacity.toFixed(3));
        target.style.setProperty(
          "--ending-copy-y",
          `${((1 - opacity) * 0.85).toFixed(3)}rem`,
        );
        target.style.setProperty(
          "--ending-copy-blur",
          `${((1 - opacity) * 0.32).toFixed(3)}rem`,
        );
        target.style.setProperty(
          "--ending-copy-scale",
          (0.985 + opacity * 0.015).toFixed(3),
        );
      });
    };

    const setVisible = (target: HTMLElement) => {
      target.classList.add("is-visible");
    };

    if (reducedMotion) {
      revealTargets.forEach(setVisible);
      dialogueLines.forEach((line) => {
        line.style.setProperty("--dialogue-opacity", "1");
        line.style.setProperty("--dialogue-y", "0rem");
      });
      balconyScene?.style.setProperty("--dialogue-ellipsis", "1");
      balconyScene?.style.setProperty("--sunset-frame-opacity", "0");
      balconyScene?.style.setProperty("--memory-pair-opacity", "1");
      balconyScene?.style.setProperty("--memory-mid-opacity", "1");
      balconyScene?.style.setProperty("--memory-final-opacity", "1");
      balconyScene?.style.setProperty("--balcony-copy-opacity", "0");
      balconyScene?.style.setProperty("--balcony-copy-y", "1.1rem");
      balconyScene?.style.setProperty("--hair-copy-opacity", "1");
      balconyScene?.style.setProperty("--hair-copy-y", "0rem");
      balconyScene?.style.setProperty("--hair-glow-opacity", "1");
      deskScene?.style.setProperty("--desk-dusk-opacity", "0");
      deskScene?.style.setProperty("--desk-night-opacity", "1");
      deskScene?.style.setProperty("--desk-copy-opacity", "1");
      deskScene?.style.setProperty("--desk-copy-y", "0rem");
      endingScene?.style.setProperty("--ending-empty-opacity", "1");
      updateEndingCopy(1);
    } else {
      const revealObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            setVisible(entry.target as HTMLElement);
            revealObserver.unobserve(entry.target);
          });
        },
        { threshold: 0.14, rootMargin: "0px 0px -10% 0px" },
      );

      revealTargets.forEach((target) => {
        if (target.getBoundingClientRect().bottom < 0) setVisible(target);
        else revealObserver.observe(target);
      });
      cleanups.push(() => revealObserver.disconnect());

    }

    const updateDialogue = (progress: number) => {
      if (!balconyScene || !dialogueLines.length || reducedMotion) return;

      const dialogueStart = 0.15;
      const dialogueEnd = 0.58;
      const dialogueProgress = clamp((progress - dialogueStart) / (dialogueEnd - dialogueStart));
      const pairCount = Math.ceil(dialogueLines.length / 2);
      const pairSegment = dialogueProgress * pairCount;
      const currentPair = Math.min(pairCount - 1, Math.floor(pairSegment));
      const localPairProgress = Math.min(pairSegment - currentPair, 1);
      const incomingWindow = 0.18;
      const replyStart = 0.45;
      const replyWindow = 0.18;

      dialogueLines.forEach((line, index) => {
        let opacity = 0;
        let offset = index % 2 === 0 ? 1.2 : -1.2;
        const pairIndex = Math.floor(index / 2);
        const isIncoming = index % 2 === 0;

        if (dialogueProgress >= 1) {
          opacity = 0;
        } else if (pairIndex === currentPair) {
          if (isIncoming) {
            opacity = clamp(localPairProgress / incomingWindow);
          } else {
            opacity = clamp((localPairProgress - replyStart) / replyWindow);
          }
          offset = (isIncoming ? 1 : -1) * (1 - opacity) * 1.2;
        } else if (pairIndex === currentPair - 1 && localPairProgress < incomingWindow) {
          opacity = 1 - clamp(localPairProgress / incomingWindow);
          offset = (isIncoming ? -1 : 1) * (1 - opacity) * 0.8;
        }

        line.style.setProperty("--dialogue-opacity", opacity.toFixed(3));
        line.style.setProperty("--dialogue-y", `${offset.toFixed(3)}rem`);
      });

      balconyScene.style.setProperty("--dialogue-ellipsis", "0");
    };

    const updateBalconyComposition = (progress: number) => {
      if (!balconyScene || reducedMotion) return;

      // Finish the sunset first, then crossfade into the memory scene. The
      // eased values keep the image and copy from snapping at the boundary.
      const sunsetIn = easeInOut((progress - 0.44) / 0.16);
      const sunsetExit = easeInOut((progress - 0.64) / 0.14);
      const sunsetFrameOpacity = sunsetIn * (1 - sunsetExit);
      const hairCopyIn = easeInOut((progress - 0.78) / 0.14);
      const midHairIn = easeInOut((progress - 0.77) / 0.13);
      const finalHairIn = easeInOut((progress - 0.9) / 0.1);
      const balconyCopyOpacity = 1 - easeInOut((progress - 0.48) / 0.16);

      balconyScene.style.setProperty("--sunset-frame-opacity", sunsetFrameOpacity.toFixed(3));
      balconyScene.style.setProperty("--memory-pair-opacity", sunsetExit.toFixed(3));
      balconyScene.style.setProperty("--memory-mid-opacity", midHairIn.toFixed(3));
      balconyScene.style.setProperty("--memory-final-opacity", finalHairIn.toFixed(3));
      balconyScene.style.setProperty(
        "--balcony-copy-opacity",
        balconyCopyOpacity.toFixed(3),
      );
      balconyScene.style.setProperty(
        "--balcony-copy-y",
        `${((1 - balconyCopyOpacity) * 1.1).toFixed(3)}rem`,
      );
      balconyScene.style.setProperty("--hair-copy-opacity", hairCopyIn.toFixed(3));
      balconyScene.style.setProperty(
        "--hair-copy-y",
        `${((1 - hairCopyIn) * 1.1).toFixed(3)}rem`,
      );
      balconyScene.style.setProperty(
        "--hair-glow-opacity",
        (sunsetExit * (0.16 + finalHairIn * 0.84)).toFixed(3),
      );
    };

    const updateDeskComposition = (progress: number) => {
      if (!deskScene || reducedMotion) return;

      const duskIn = easeInOut((progress - 0.14) / 0.28);
      const duskOut = easeInOut((progress - 0.48) / 0.26);
      const duskOpacity = duskIn * (1 - duskOut);
      const nightIn = easeInOut((progress - 0.46) / 0.48);
      const copyIn = easeInOut((progress - 0.08) / 0.24);
      const copyOut = easeInOut((progress - 0.86) / 0.14);
      const copyOpacity = copyIn * (1 - copyOut);

      deskScene.style.setProperty("--desk-dusk-opacity", duskOpacity.toFixed(3));
      deskScene.style.setProperty("--desk-night-opacity", nightIn.toFixed(3));
      deskScene.style.setProperty("--desk-copy-opacity", copyOpacity.toFixed(3));
      deskScene.style.setProperty(
        "--desk-copy-y",
        `${((1 - copyIn) * 1.1 + copyOut * 0.75).toFixed(3)}rem`,
      );
    };

    const updateEndingComposition = (progress: number) => {
      if (!endingScene || reducedMotion) return;

      const emptyIn = easeInOut((progress - 0.2) / 0.74);

      endingScene.style.setProperty("--ending-empty-opacity", emptyIn.toFixed(3));
      updateEndingCopy(progress);
    };

    const updateSceneProgress = () => {
      scrollFrame = 0;
      scenes.forEach((scene) => {
        const rect = scene.getBoundingClientRect();
        const travel = Math.max(scene.offsetHeight - window.innerHeight * 0.64, 1);
        const progress = reducedMotion
          ? 1
          : clamp((window.innerHeight * 0.2 - rect.top) / travel);
        scene.style.setProperty("--film-progress", progress.toFixed(4));
        if (scene === balconyScene) {
          updateDialogue(progress);
          updateBalconyComposition(progress);
        } else if (scene === deskScene) {
          updateDeskComposition(progress);
        } else if (scene === endingScene) {
          updateEndingComposition(progress);
        }
      });
    };

    const queueSceneProgress = () => {
      if (!scrollFrame) scrollFrame = window.requestAnimationFrame(updateSceneProgress);
    };

    updateSceneProgress();
    window.addEventListener("scroll", queueSceneProgress, { passive: true });
    window.addEventListener("resize", queueSceneProgress);
    cleanups.push(
      () => window.removeEventListener("scroll", queueSceneProgress),
      () => window.removeEventListener("resize", queueSceneProgress),
      () => window.cancelAnimationFrame(scrollFrame),
    );

    return () => cleanups.forEach((cleanup) => cleanup());
  });
</script>

<article
  bind:this={filmRoot}
  id="grandma-film"
  class="grandma-film markdown-content"
  class:grandma-film--plain={plainTextMode}
  aria-label="在奶奶的白发里，我看见了时间"
>
  <aside class="grandma-film__desktop-note" role="note" aria-label="阅读提示">
    <span class="grandma-film__desktop-note-label">阅读提示</span>
    <p>动态版适配 PC 端，手机端默认使用原始 Markdown 版。</p>
  </aside>

  <div class="grandma-film__mode-switcher" role="group" aria-label="文章阅读模式">
    <button
      type="button"
      class="grandma-film__mode-button"
      aria-controls="grandma-film-interactive grandma-film-plain"
      aria-pressed={plainTextMode}
      onclick={toggleTextMode}
    >
      {plainTextMode ? "切换动态版本" : "切换纯文本版本"}
    </button>
    <p>手机端默认显示原始 Markdown 版，电脑端可在两种版本间切换。</p>
    {#if mobileNoticeVisible}
      <p class="grandma-film__mode-feedback" role="status" aria-live="polite">
        您的小设备没做适配哦~
      </p>
    {/if}
  </div>

  <div id="grandma-film-interactive" class="grandma-film__interactive" hidden={plainTextMode}>
  <section class="grandma-film__prose grandma-film__prose--opening" data-film-reveal>
    <p>休假结束后，又隔了许久没正经写点东西。</p>
    <p>其实心里一直堆着满当当的感慨，千头万绪堵在喉咙口，真要落笔时，却又不知道该从何说起。索性就聊聊这半个多月以来，沉在心底的几分真实感受。</p>
  </section>

  <section class="grandma-film__chapter grandma-film__chapter--arrival">
    <h2 id="起因" data-film-reveal>起因</h2>
    <div class="grandma-film__date-track" aria-label="假期时间线">
      <div class="grandma-film__date-item" data-film-reveal>
        <time datetime="2026-08-28">8 / 28</time>
        <span>开始休假</span>
      </div>
      <div class="grandma-film__date-item grandma-film__date-item--home" data-film-reveal>
        <time datetime="2026-08-31">8 / 31 — 9 / 1</time>
        <span>回了两天家</span>
      </div>
      <div class="grandma-film__date-item" data-film-reveal>
        <time datetime="2026-09-06">9 / 6</time>
        <span>假期结束</span>
      </div>
    </div>
    <div class="grandma-film__prose grandma-film__prose--narrow" data-film-reveal>
      <p>假期从 8 月 28 日开始，一直到 9 月 6 日。8 月 31 日和 9 月 1 日，我回了两天家。算下来，前前后后还是有将近半个月，没有像往常那样好好待在家里。</p>
      <p>放在以前，每周休息日我总要抽一天回去，看看家里人，吃顿热乎的家常菜。这件事早已经成了不用刻意提醒的习惯。可这次一下子隔了这么久，再踏进家门的时候，竟莫名生出了一点生疏的亲切感。</p>
    </div>
  </section>

  <section class="grandma-film__scene grandma-film__scene--balcony" data-film-scene aria-label="奶奶先坐在阳台上，我走过去坐到她身边">
    <h2 id="在奶奶的白发里看见时间" class="grandma-film__toc-heading grandma-film__toc-heading--scene-anchor">在奶奶的白发里，看见时间</h2>
    <div class="grandma-film__sticky">
      <div class="grandma-film__image-pair" aria-hidden="true">
        <img class="grandma-film__image grandma-film__image--base" src={balconyWaiting} alt="" />
        <img class="grandma-film__image grandma-film__image--approaching" src={balconyApproaching} alt="" />
        <img class="grandma-film__image grandma-film__image--together" src={balconyTogether} alt="" />
        <img class="grandma-film__image grandma-film__image--sunset" src={balconySunset} alt="" />
        <span class="grandma-film__light-sweep"></span>
      </div>
      <div class="grandma-film__image-pair grandma-film__image-pair--memory" aria-hidden="true">
        <img class="grandma-film__image grandma-film__image--memory-base" src={grandmaMemory} alt="" />
        <img class="grandma-film__image grandma-film__image--memory-mid" src={grandmaHair} alt="" />
        <img class="grandma-film__image grandma-film__image--memory-final" src={grandmaHair} alt="" />
        <span class="grandma-film__hair-glow"></span>
      </div>
      <p class="grandma-film__scroll-hint" role="note"><span class="grandma-film__scroll-icon" aria-hidden="true"></span>缓慢滚动鼠标，播放动画</p>
      <div class="grandma-film__scene-copy grandma-film__scene-copy--balcony" data-film-reveal>
        <p class="grandma-film__small-label">周日下午 · 饭后</p>
        <p>奶奶已经坐在阳台上了。我从屋里走出来，搬了张凳子，坐到她身边。</p>
        <p>接下来的很长一段时间，我们一句接一句地聊着。</p>
      </div>
      <div class="grandma-film__scene-copy grandma-film__scene-copy--hair-transition">
        <p class="grandma-film__small-label">那一刻</p>
        <p>我正讲得起劲，目光无意间扫过她的头发。</p>
        <p class="grandma-film__line-emphasis">那一刻，我像是忽然看见了时间留下的证据。</p>
      </div>
      <div class="grandma-film__dialogue" aria-label="我和奶奶的阳台对话">
        <span class="grandma-film__dialogue-notice">周日下午 · 阳台</span>
        <article class="grandma-film__dialogue-line grandma-film__dialogue-line--incoming" data-film-dialogue-line>
          <span class="grandma-film__dialogue-name">奶奶</span>
          <p>最近工作怎么样？</p>
        </article>
        <article class="grandma-film__dialogue-line grandma-film__dialogue-line--outgoing" data-film-dialogue-line>
          <span class="grandma-film__dialogue-name">我</span>
          <p>还行。就是一直在想，之后到底要走什么样的路。</p>
        </article>
        <article class="grandma-film__dialogue-line grandma-film__dialogue-line--incoming" data-film-dialogue-line>
          <span class="grandma-film__dialogue-name">奶奶</span>
          <p>想好了吗？</p>
        </article>
        <article class="grandma-film__dialogue-line grandma-film__dialogue-line--outgoing" data-film-dialogue-line>
          <span class="grandma-film__dialogue-name">我</span>
          <p>还没有。但我想趁年轻，做点真正属于自己的事情。</p>
        </article>
        <article class="grandma-film__dialogue-line grandma-film__dialogue-line--incoming" data-film-dialogue-line>
          <span class="grandma-film__dialogue-name">奶奶</span>
          <p>想做什么就去做。别总想着等以后。</p>
        </article>
        <article class="grandma-film__dialogue-line grandma-film__dialogue-line--outgoing" data-film-dialogue-line>
          <span class="grandma-film__dialogue-name">我</span>
          <p>我只是怕走错路，也怕来不及陪你。</p>
        </article>
        <article class="grandma-film__dialogue-line grandma-film__dialogue-line--incoming" data-film-dialogue-line>
          <span class="grandma-film__dialogue-name">奶奶</span>
          <p>你能回来坐坐，我就高兴。</p>
        </article>
        <article class="grandma-film__dialogue-line grandma-film__dialogue-line--outgoing" data-film-dialogue-line>
          <span class="grandma-film__dialogue-name">我</span>
          <p>嗯，那我常回来。</p>
        </article>
        <article class="grandma-film__dialogue-line grandma-film__dialogue-line--incoming" data-film-dialogue-line>
          <span class="grandma-film__dialogue-name">奶奶</span>
          <p>……</p>
        </article>
        <article class="grandma-film__dialogue-line grandma-film__dialogue-line--outgoing" data-film-dialogue-line>
          <span class="grandma-film__dialogue-name">我</span>
          <p>……</p>
        </article>
      </div>
    </div>
  </section>

  <section class="grandma-film__prose grandma-film__prose--narrow" data-film-reveal>
    <p>从前印象里，她总还留着大半黑发，常常笑着说自己头发白得慢，用不着染。可那天下午，太阳斜斜地落下来，明晃晃照得一清二楚——哪里还有什么黑发，满头都已经是霜白的颜色，连鬓角深处藏着的几根，也全都白透了。</p>
    <p>我的心里猛地咯噔一下，话音也不自觉顿了半拍。</p>
    <p>她依旧坐在那里听我说话，依旧会在我起身的时候问一句，要不要再带点什么。可我忽然意识到，那个我以为一直都会在的奶奶，也正在一天一天地老去。</p>
  </section>

  <section class="grandma-film__quote" data-film-reveal>
    <p>我到底，还剩下多少这样的日子？</p>
    <span>还能有多少次，这样安安静静地坐在她身边？</span>
  </section>

  <section class="grandma-film__chapter grandma-film__chapter--time">
    <h2 id="时间从来不会等你准备好" data-film-reveal>时间从来不会等你准备好</h2>
    <div class="grandma-film__prose grandma-film__prose--narrow">
      <p data-film-reveal>时间从来都是最残忍的东西。它不声不响，从不停留。你总觉得日子还长，总想着等忙完这阵，等做出点成绩，等站稳脚跟以后，再好好陪陪家人。</p>
      <p class="grandma-film__paragraph-break" data-film-reveal>可时间从来不会等你准备好。</p>
      <p data-film-reveal>它就藏在奶奶新生的白发里，藏在每次回家时她递过来的热汤里，藏在一句句“在外面照顾好自己”的叮嘱里。不知不觉间，它已经把我们的岁月翻过去了大半。</p>
      <p data-film-reveal>也是从那时起，我重新想起了“时间”这件事。</p>
      <p data-film-reveal>以前我总觉得，上班嘛，说白了就是公司用钱买你的时间。每天八小时坐满，工作干到位，就对得起这份薪水。</p>
      <p data-film-reveal>可后来我慢慢想明白，公司真正买走的，或许不是你的时间，而是你在这段时间里能够交付的价值。而你拿去交换的，却是人生中一段不可回收的时间。</p>
      <p data-film-reveal>最遗憾的是，很多人卖着卖着，就把自己整段的人生都打包卖了出去。</p>
      <p data-film-reveal>连带着下班后的精力、对未来的规划、对生活的期待，全都困在了那份固定的薪水里。白天把时间交给工作，晚上把精力交给疲惫，等真正想做点自己的事情时，才发现已经没有多少力气了。</p>
      <p data-film-reveal>我们总以为以后还有机会。</p>
      <blockquote data-film-reveal>“以后”这两个字，往往是时间最温柔、也最危险的骗局。</blockquote>
      <p data-film-reveal>我今年 21 岁。过去的人生，几张幻灯片、几页简历就能全部放完，快得像一眨眼。再晃几年，三十岁也就到了。</p>
      <p data-film-reveal>这个年纪的我，没有太多资源，也没有一张保证成功的底牌。但至少，我还拥有试错的时间，还拥有重新开始的可能。</p>
      <p data-film-reveal>我不想等到那时候回头看，才发现自己最好的年纪，全都用来给别人的事业添砖加瓦，自己的时间、精力和选择，却始终没有真正掌握在自己手里。</p>
    </div>
  </section>

  <section class="grandma-film__scene grandma-film__scene--desk" data-film-scene aria-label="从工作到自己的事情">
      <h2 id="我要把时间的主动权拿回来" class="grandma-film__toc-heading">我要把时间的主动权拿回来</h2>
    <div class="grandma-film__sticky">
      <div class="grandma-film__image-pair" aria-hidden="true">
        <img class="grandma-film__image grandma-film__image--base" src={deskDay} alt="" />
        <img class="grandma-film__image grandma-film__image--dusk" src={deskDusk} alt="" />
        <img class="grandma-film__image grandma-film__image--top" src={deskNight} alt="" />
        <span class="grandma-film__desk-glow"></span>
      </div>
      <p class="grandma-film__scroll-hint" role="note"><span class="grandma-film__scroll-icon" aria-hidden="true"></span>缓慢滚动鼠标，播放动画</p>
      <div class="grandma-film__scene-copy grandma-film__scene-copy--desk" data-film-reveal>
        <p class="grandma-film__small-label">再晃几年</p>
        <p class="grandma-film__line-emphasis">所以我想，我得把时间的主动权拿回来。</p>
      </div>
    </div>
  </section>

  <section class="grandma-film__chapter grandma-film__chapter--startup">
    <h2 id="决定自己创业" data-film-reveal>我要自己创业了</h2>
    <div class="grandma-film__prose grandma-film__prose--narrow">
      <p data-film-reveal>这句话写出来很轻，可真正扛在身上，一点都不轻。</p>
      <p data-film-reveal>上班这半年，我其实从来没有停下过自己的事情。从接触跨境电商的第一天开始，我的方向就不是传统电商那条老路。</p>
      <p data-film-reveal>别人靠铺货，靠低价，靠不断复制别人已经走过的路径；而我更想磨出一套属于自己的玩法——跨境电商 + AIGC + OPC。</p>
      <p data-film-reveal>从选品逻辑，到内容生产，再到店铺运营，把能够流程化、自动化的环节尽可能沉淀下来。这样以后不管是铺店，还是复制运营方式，都不需要每次从头开始。</p>
      <p class="grandma-film__paragraph-break" data-film-reveal>这不是一时头脑发热的冲动，但也确实带着一股头脑发热的勇气。</p>
      <p class="grandma-film__fear" data-film-reveal>我害怕。</p>
      <p data-film-reveal>尤其是奶奶。有些人，或许真的等不起我们口中的“以后”。</p>
      <p data-film-reveal>接下来，我会带着这套 Codex，一步一步运营两家店铺：一家完全交给 Codex，去跑一套由我设计好的运营流程；另一家则由我自己独立运营，亲自做判断，也亲自承担结果。</p>
      <p data-film-reveal>这既是创业，也是一次实验。</p>
      <p data-film-reveal>我想看看，一个人究竟能不能借助 AI，把自己的想法真正落地；也想看看，当工具越来越强，一个普通人能不能拥有一套不依赖大团队的工作方式。</p>
    </div>
  </section>

  <section class="grandma-film__chapter grandma-film__chapter--truth">
    <h2 id="我知道创业不等于自由" data-film-reveal>我知道创业不等于自由</h2>
    <div class="grandma-film__prose grandma-film__prose--narrow">
      <p data-film-reveal>当然，我知道创业不等于自由。</p>
      <p data-film-reveal>至少在一开始，它意味着更多的不确定、更长的工作时间，以及更直接的压力。上班有固定的发薪日，有同事、有流程，也有人替你分担一部分问题。自己做以后，没有人会替你回答为什么没有订单，为什么犯了错，为什么还没有结果。</p>
      <p data-film-reveal>这些我都知道。</p>
      <p data-film-reveal>所以我并不是因为看不起上班，也不是因为笃定自己一定会成功，才选择走这条路。</p>
      <p data-film-reveal>恰恰是因为我知道它可能很难，甚至可能失败，所以才想趁自己还年轻的时候，认真为自己闯一次。</p>
      <p data-film-reveal>有人说，安稳上班不好吗，何必折腾？</p>
      <p data-film-reveal>可我总觉得，人活着，就是要争这一口气。</p>
      <p class="grandma-film__line-emphasis" data-film-reveal>争的不是和谁比高低，也不是非要证明自己比别人强。争的是一份对人生的主动权。</p>
      <p data-film-reveal>我要自己决定每天的时间花在哪里，决定自己的精力投入什么事情，决定自己愿意为什么样的结果负责。</p>
      <p data-film-reveal>我想靠自己的双手，走出一条不一样的路。</p>
      <p data-film-reveal>哪怕这条路并不平坦，哪怕中间会绕远、会犯错、会有一段时间看不到结果，至少那也是我自己选的路。</p>
      <p data-film-reveal>不想等到白发爬上自己鬓角的时候，才遗憾年轻时没有为自己认真活过一次。</p>
    </div>
  </section>

  <section class="grandma-film__scene grandma-film__scene--ending" data-film-scene aria-label="蓝调时刻的空阳台">
    <h2 id="路是走出来的不是想出来的" class="grandma-film__toc-heading">路是走出来的，不是想出来的</h2>
    <div class="grandma-film__sticky">
      <div class="grandma-film__image-pair" aria-hidden="true">
        <img class="grandma-film__image grandma-film__image--base" src={balconySunset} alt="" />
        <img class="grandma-film__image grandma-film__image--top" src={balconyEmpty} alt="" />
        <span class="grandma-film__vignette"></span>
      </div>
      <p class="grandma-film__scroll-hint" role="note"><span class="grandma-film__scroll-icon" aria-hidden="true"></span>缓慢滚动鼠标，播放动画</p>
      <div class="grandma-film__ending-copy" aria-label="文章结尾">
        <p data-ending-copy data-ending-start="0.06" data-ending-end="0.22">其实还有很多情绪没有说出口，也不必都说透。</p>
        <p data-ending-copy data-ending-start="0.19" data-ending-end="0.35">千言万语，最终都要落到实处。</p>
        <h2 data-ending-copy data-ending-start="0.32" data-ending-end="0.53">路是走出来的，<br />不是想出来的。</h2>
        <p data-ending-copy data-ending-start="0.5" data-ending-end="0.67">也希望读到这篇文章的人，能够珍惜时间，珍惜身边的人。</p>
        <p data-ending-copy data-ending-start="0.63" data-ending-end="0.8">不要把所有重要的事情，都推给那个永远不会真正到来的“以后”。因为我们以为还很长的日子，可能转眼就过去了。</p>
        <p data-ending-copy data-ending-start="0.76" data-ending-end="0.93">接下来的日子，我会把这些想法一点一点做出来，也把该承担的结果一一接住。</p>
        <p class="grandma-film__last-line" data-ending-copy data-ending-start="0.89" data-ending-end="1">真正值得抓住的，往往就是眼前这一刻。</p>
      </div>
    </div>
  </section>

  </div>

  <div id="grandma-film-plain" class="grandma-film__plain-content" hidden={!plainTextMode}>
    <slot name="plain" />
  </div>
</article>

<style>
  .grandma-film {
    --film-ink: color-mix(in oklab, var(--text-color) 95%, #513b2d);
    --film-muted: color-mix(in oklab, var(--text-color) 58%, #9a6c4a);
    --film-line: color-mix(in oklab, var(--line-divider) 78%, #c99967);
    --film-warm: #b46b36;
    --film-blue: #42617e;
    --film-paper: color-mix(in oklab, var(--card-bg) 92%, #fff7e9);
    --film-dialogue-bg: #fff;
    --film-dialogue-ink: #243128;
    --film-dialogue-name: rgba(39, 56, 43, 0.58);
    --film-dialogue-notice-bg: rgba(247, 250, 247, 0.82);
    --film-dialogue-notice-ink: rgba(44, 62, 49, 0.72);
    --film-dialogue-outgoing-bg: #95ec69;
    --film-dialogue-outgoing-ink: #243128;
    width: 100%;
    margin: 0 auto 4.5rem;
    color: var(--film-ink);
    overflow: visible;
  }

  :global(:root.dark) .grandma-film {
    --film-ink: color-mix(in oklab, var(--text-color) 96%, #f0c39a);
    --film-muted: color-mix(in oklab, var(--text-color) 62%, #d9a77e);
    --film-line: color-mix(in oklab, var(--line-divider) 68%, #c28e69);
    --film-warm: #e4a064;
    --film-blue: #8fc7ec;
    --film-paper: color-mix(in oklab, var(--card-bg) 90%, #503a2e);
    --film-dialogue-bg: color-mix(in oklab, var(--card-bg) 90%, #5b4839);
    --film-dialogue-ink: #f4e7d5;
    --film-dialogue-name: color-mix(in oklab, var(--film-ink) 66%, transparent);
    --film-dialogue-notice-bg: color-mix(in oklab, var(--card-bg) 88%, #31513c);
    --film-dialogue-notice-ink: #dcebdc;
    --film-dialogue-outgoing-bg: #3d8243;
    --film-dialogue-outgoing-ink: #eff9e9;
  }

  :global(#post-container:has(.grandma-film)),
  :global(.col-span-1:has(.grandma-film)),
  :global(.flex.w-full:has(.grandma-film)) {
    overflow: visible !important;
  }

  .grandma-film__scene {
    --film-progress: 0;
    position: relative;
    min-height: 155vh;
    margin-inline: 0;
    width: 100%;
  }

  .grandma-film__toc-heading {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    border: 0;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .grandma-film__toc-heading--flow-anchor {
    position: relative;
    width: 1px;
    height: 1px;
    margin: 0;
    overflow: hidden;
  }

  .grandma-film__toc-heading--scene-anchor {
    top: 0;
    left: 0;
  }

  .grandma-film__scene--balcony {
    min-height: 1150vh;
    --dialogue-ellipsis: 0;
  }

  .grandma-film__scene--desk {
    min-height: 300vh;
    background: transparent;
    color: #f6e3c6;
  }

  .grandma-film__scene--ending {
    min-height: 235vh;
    color: #fff8e9;
  }

  .grandma-film__sticky {
    position: sticky;
    top: max(5.5rem, calc(5rem + (100vh - 5rem - min(76vh, 48rem)) / 2));
    height: min(76vh, 48rem);
    min-height: 30rem;
    isolation: isolate;
  }

  .grandma-film__scroll-hint {
    position: absolute;
    z-index: 5;
    right: 0;
    bottom: clamp(0.75rem, 2.5vh, 1.4rem);
    left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.85rem;
    margin: 0;
    color: rgba(255, 248, 233, 0.92);
    font-size: clamp(0.95rem, 1.35vw, 1.18rem);
    font-weight: 800;
    letter-spacing: 0.1em;
    line-height: 1.4;
    text-shadow: 0 0.12rem 0.75rem rgba(0, 0, 0, 0.58);
    opacity: clamp(0, calc((1 - var(--film-progress)) * 4), 1);
    transform: translate3d(0, calc(var(--film-progress) * 0.5rem), 0);
    transition: opacity 320ms ease, transform 520ms cubic-bezier(0.16, 1, 0.3, 1);
    white-space: nowrap;
    pointer-events: none;
  }

  .grandma-film__scroll-hint::before,
  .grandma-film__scroll-hint::after {
    width: clamp(1.6rem, 5vw, 3.2rem);
    height: 2px;
    background: currentColor;
    content: "";
    opacity: 0.58;
  }

  .grandma-film__scroll-icon {
    position: relative;
    display: inline-block;
    width: 1.12rem;
    height: 1.62rem;
    border: 2px solid currentColor;
    border-radius: 0.72rem;
    box-shadow: 0 0 0.8rem rgba(255, 248, 233, 0.2);
    flex: 0 0 auto;
  }

  .grandma-film__scroll-icon::before {
    position: absolute;
    top: 0.28rem;
    left: 50%;
    width: 0.18rem;
    height: 0.42rem;
    border-radius: 999px;
    background: currentColor;
    content: "";
    transform: translateX(-50%);
    animation: grandma-film-scroll-wheel 1.45s ease-in-out infinite;
  }

  @keyframes grandma-film-scroll-wheel {
    0%,
    100% {
      opacity: 0.45;
      transform: translate(-50%, 0);
    }

    50% {
      opacity: 1;
      transform: translate(-50%, 0.26rem);
    }
  }

  .grandma-film__image-pair {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: #3d302b;
    border-radius: 1rem;
  }

  .grandma-film__image-pair--memory {
    z-index: 1;
    opacity: var(--memory-pair-opacity, clamp(0, calc((var(--film-progress) - 0.6) * 7.15), 1));
    transition: opacity 260ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .grandma-film__image {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    transform: scale(calc(1.04 - var(--film-progress) * 0.035));
    filter: saturate(calc(0.94 + var(--film-progress) * 0.1)) contrast(calc(0.96 + var(--film-progress) * 0.08));
    transition: opacity 420ms ease;
  }

  .grandma-film__image--base {
    opacity: 1;
  }

  .grandma-film__image--approaching {
    opacity: clamp(0, min(calc((var(--film-progress) - 0.11) * 11), calc((0.32 - var(--film-progress)) * 11)), 1);
  }

  .grandma-film__image--together {
    opacity: clamp(0, calc((var(--film-progress) - 0.27) * 10), 1);
  }

  .grandma-film__image--sunset {
    opacity: var(--sunset-frame-opacity, clamp(0, calc((var(--film-progress) - 0.78) * 4.55), 1));
  }

  .grandma-film__scene--desk .grandma-film__image--dusk {
    opacity: var(--desk-dusk-opacity, 0);
  }

  .grandma-film__scene--desk .grandma-film__image--dusk,
  .grandma-film__scene--desk .grandma-film__image--top {
    transition: opacity 560ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .grandma-film__scene--desk .grandma-film__image--top {
    opacity: var(--desk-night-opacity, 0);
  }

  .grandma-film__scene--ending .grandma-film__image--base {
    opacity: calc(1 - var(--ending-empty-opacity, 0));
    transform: scale(calc(1.04 - var(--film-progress) * 0.014));
    filter: saturate(calc(1.06 - var(--film-progress) * 0.56)) brightness(calc(1.03 - var(--film-progress) * 0.22));
    transition: opacity 700ms cubic-bezier(0.16, 1, 0.3, 1), filter 900ms ease, transform 1200ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .grandma-film__scene--ending .grandma-film__image--top {
    opacity: var(--ending-empty-opacity, 0);
    transform: scale(calc(1.025 - var(--film-progress) * 0.01));
    filter: saturate(calc(0.68 + var(--film-progress) * 0.12)) brightness(calc(0.86 + var(--film-progress) * 0.1));
    transition: opacity 700ms cubic-bezier(0.16, 1, 0.3, 1), filter 900ms ease, transform 1200ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .grandma-film__image--memory-base {
    opacity: 1;
  }

  .grandma-film__image--memory-mid {
    opacity: calc(var(--memory-mid-opacity, clamp(0, calc((var(--film-progress) - 0.73) * 7.7), 1)) * 0.82);
    filter: saturate(1.02) contrast(1.02);
  }

  .grandma-film__image--memory-final {
    opacity: var(--memory-final-opacity, clamp(0, calc((var(--film-progress) - 0.86) * 7.15), 1));
    filter: saturate(1.02) contrast(1.02);
  }

  .grandma-film__sun-haze,
  .grandma-film__light-sweep,
  .grandma-film__hair-glow,
  .grandma-film__desk-glow,
  .grandma-film__vignette {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .grandma-film__sun-haze {
    background: radial-gradient(circle at 74% 26%, rgba(255, 244, 194, 0.36), transparent 27%);
    opacity: calc(0.24 + var(--film-progress) * 0.42);
    mix-blend-mode: screen;
  }

  .grandma-film__light-sweep {
    inset: -20% -30%;
    background: linear-gradient(112deg, transparent 32%, rgba(255, 232, 170, 0.2) 47%, transparent 60%);
    transform: translateX(calc((var(--film-progress) - 0.5) * 32%));
    opacity: 0.8;
  }

  .grandma-film__hair-glow {
    background: radial-gradient(ellipse at 35% 38%, rgba(255, 224, 165, 0.24), transparent 33%);
    opacity: var(--hair-glow-opacity, 0);
    mix-blend-mode: screen;
  }

  .grandma-film__desk-glow {
    background: radial-gradient(ellipse at 50% 58%, rgba(80, 156, 255, 0.22), transparent 38%);
    opacity: calc(var(--film-progress) * 0.82);
    mix-blend-mode: screen;
  }

  .grandma-film__vignette {
    background: linear-gradient(180deg, rgba(19, 18, 18, 0.06), rgba(19, 18, 18, 0.48));
  }

  .grandma-film__scene--ending .grandma-film__vignette {
    opacity: calc(0.12 + var(--film-progress) * 0.42);
    transition: opacity 700ms ease;
  }

  .grandma-film__scene-copy,
  .grandma-film__ending-copy {
    position: absolute;
    z-index: 2;
    max-width: 42rem;
    padding: clamp(1.5rem, 4vw, 4rem);
    color: #fff8e9;
    text-shadow: 0 0.18rem 1.2rem rgba(0, 0, 0, 0.42);
  }

  .grandma-film__scene-copy {
    left: clamp(1.2rem, 7vw, 9rem);
    bottom: clamp(1.2rem, 8vh, 6rem);
    max-width: min(36rem, 72vw);
  }

  .grandma-film__scene-copy--balcony {
    z-index: 3;
    max-width: min(34rem, 68vw);
    opacity: var(--balcony-copy-opacity, 1);
    transform: translate3d(0, var(--balcony-copy-y, 0rem), 0);
    transition: opacity 260ms ease, transform 420ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .grandma-film__scene-copy--hair-transition {
    z-index: 3;
    max-width: min(35rem, 78vw);
    opacity: var(--hair-copy-opacity, clamp(0, calc((var(--film-progress) - 0.7) * 3.34), 1));
    transform: translate3d(0, var(--hair-copy-y, 1.1rem), 0);
    pointer-events: none;
    transition: opacity 320ms ease, transform 520ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .grandma-film__scene-copy--desk {
    opacity: var(--desk-copy-opacity, 1);
    transform: translate3d(0, var(--desk-copy-y, 0rem), 0);
    transition: opacity 320ms ease, transform 520ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .grandma-film__ending-copy {
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    max-width: none;
    overflow: hidden;
    text-align: center;
    gap: clamp(0.05rem, 0.45vh, 0.3rem);
  }

  .grandma-film__ending-copy > [data-ending-copy] {
    position: static;
    width: auto;
    margin: 0;
    opacity: var(--ending-copy-opacity, 1);
    transform: translate3d(0, var(--ending-copy-y, 0rem), 0) scale(var(--ending-copy-scale, 1));
    filter: blur(var(--ending-copy-blur, 0rem));
    transition: opacity 380ms linear, transform 520ms cubic-bezier(0.16, 1, 0.3, 1), filter 520ms ease;
  }

  .grandma-film__ending-copy h2 {
    margin: 0.1rem 0 0.35rem;
    color: inherit;
    font-size: clamp(1.75rem, 4.2vh, 4rem);
    font-weight: 800;
    letter-spacing: -0.055em;
    line-height: 1;
  }

  .grandma-film__ending-copy > p {
    max-width: min(34rem, 100%);
    margin: 0;
    font-size: clamp(0.78rem, 1.55vh, 1.12rem);
    line-height: 1.56;
  }

  .grandma-film__small-label,
  .grandma-film__scroll-note {
    color: currentColor;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }

  .grandma-film__scroll-note {
    display: inline-block;
    margin-top: 2rem;
    padding-top: 0.85rem;
    border-top: 1px solid rgba(255, 247, 224, 0.5);
    letter-spacing: 0.08em;
  }

  .grandma-film__prose,
  .grandma-film__chapter,
  .grandma-film__quote {
    width: min(100%, 74ch);
    margin-inline: auto;
  }

  .grandma-film__desktop-note {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    width: min(calc(100% - 2rem), 58rem);
    margin: 0 auto;
    padding: 0.9rem 1.15rem;
    border: 1px solid color-mix(in oklab, var(--film-blue) 24%, var(--film-line));
    border-radius: 0.9rem;
    background: linear-gradient(120deg, color-mix(in oklab, var(--film-paper) 90%, #dcefff), var(--film-paper));
    box-shadow: 0 0.7rem 1.8rem rgba(66, 97, 126, 0.08);
    color: var(--film-ink);
  }

  :global(:root.dark) .grandma-film__desktop-note {
    background: linear-gradient(
      120deg,
      color-mix(in oklab, var(--film-paper) 88%, #2a4355),
      var(--film-paper)
    );
    box-shadow: 0 0.7rem 1.8rem rgba(0, 0, 0, 0.22);
  }

  .grandma-film__desktop-note::before {
    flex: 0 0 auto;
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--film-blue);
    box-shadow: 0 0 0 0.3rem color-mix(in srgb, var(--film-blue) 13%, transparent);
    content: "";
  }

  .grandma-film__desktop-note-label {
    flex: 0 0 auto;
    color: var(--film-blue);
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    white-space: nowrap;
  }

  .grandma-film__desktop-note p {
    margin: 0;
    color: var(--film-muted);
    font-size: clamp(0.9rem, 1.4vw, 1rem);
    line-height: 1.7;
  }

  .grandma-film__mode-switcher {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.45rem;
    margin: 1rem auto 0;
    text-align: center;
  }

  .grandma-film__mode-button {
    min-height: 2.75rem;
    padding: 0.62rem 1.25rem;
    border: 1px solid color-mix(in oklab, var(--film-blue) 30%, var(--film-line));
    border-radius: 0.85rem;
    background: var(--film-paper);
    box-shadow: 0 0.55rem 1.4rem rgba(66, 97, 126, 0.1);
    color: var(--film-blue);
    cursor: pointer;
    font: inherit;
    font-size: 0.95rem;
    font-weight: 800;
    line-height: 1.35;
    transition: background-color 180ms ease, border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
  }

  .grandma-film__mode-button:hover {
    border-color: color-mix(in oklab, var(--film-blue) 52%, var(--film-line));
    background: color-mix(in oklab, var(--film-paper) 82%, #dcefff);
    box-shadow: 0 0.75rem 1.7rem rgba(66, 97, 126, 0.14);
    transform: translateY(-1px);
  }

  :global(:root.dark) .grandma-film__mode-button:hover {
    background: color-mix(in oklab, var(--film-paper) 82%, #2a4355);
    box-shadow: 0 0.75rem 1.7rem rgba(0, 0, 0, 0.28);
  }

  .grandma-film__mode-button:focus-visible {
    outline: 3px solid color-mix(in srgb, var(--film-blue) 32%, transparent);
    outline-offset: 3px;
  }

  .grandma-film__mode-button:active {
    transform: translateY(1px);
  }

  .grandma-film__mode-switcher p {
    margin: 0;
    color: var(--film-muted);
    font-size: 0.78rem;
    line-height: 1.55;
  }

  .grandma-film__prose--opening {
    padding: clamp(4rem, 10vw, 9rem) 0 clamp(3rem, 8vw, 7rem);
    font-size: clamp(1.05rem, 1.7vw, 1.28rem);
    line-height: 1.95;
  }

  .grandma-film__prose--narrow {
    max-width: 65ch;
    padding-block: 1rem;
  }

  .grandma-film__prose p {
    margin: 1.2rem 0;
  }

  .grandma-film__chapter {
    padding-block: clamp(4rem, 9vw, 9rem);
    scroll-margin-top: 6rem;
  }

  .grandma-film__chapter h2 {
    margin: 0 0 1.5rem;
    color: inherit;
    font-size: clamp(1.8rem, 4vw, 3.8rem);
    font-weight: 800;
    letter-spacing: -0.045em;
    line-height: 1.12;
  }

  .grandma-film__chapter h2[id],
  .grandma-film__toc-heading[id] {
    scroll-margin-top: 7.5rem;
  }

  .grandma-film__chapter--arrival,
  .grandma-film__chapter--time,
  .grandma-film__chapter--startup,
  .grandma-film__chapter--truth {
    border-top: 1px solid var(--film-line);
  }

  .grandma-film__date-track {
    position: relative;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
    margin: 3rem 0 1rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--film-line);
  }

  .grandma-film__date-track::before {
    position: absolute;
    top: -0.22rem;
    left: 0;
    width: 0.42rem;
    height: 0.42rem;
    border-radius: 50%;
    background: var(--film-warm);
    box-shadow: 0 0 0 0.34rem color-mix(in srgb, var(--film-warm) 15%, transparent);
    content: "";
  }

  .grandma-film__date-item {
    display: grid;
    gap: 0.5rem;
    min-height: 4rem;
  }

  .grandma-film__date-item time {
    color: var(--film-warm);
    font-size: 1.1rem;
    font-weight: 800;
    letter-spacing: 0.04em;
  }

  .grandma-film__date-item span {
    color: var(--film-muted);
    font-size: 0.94rem;
  }

  .grandma-film__dialogue {
    position: absolute;
    z-index: 4;
    top: clamp(0.75rem, 2vh, 1.5rem);
    right: clamp(1rem, 5vw, 6rem);
    left: clamp(1rem, 5vw, 6rem);
    width: auto;
    min-height: 11rem;
    color: var(--film-ink);
    text-shadow: none;
  }

  .grandma-film__dialogue-notice {
    position: absolute;
    top: 0.2rem;
    left: 0;
    display: block;
    margin: 0;
    width: fit-content;
    padding: 0.32rem 0.65rem;
    border-radius: 999px;
    background: var(--film-dialogue-notice-bg);
    box-shadow: 0 0.35rem 1.1rem rgba(30, 50, 35, 0.14);
    color: var(--film-dialogue-notice-ink);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.13em;
  }

  .grandma-film__dialogue-line {
    position: absolute;
    inset: 2.2rem 0 auto;
    width: fit-content;
    max-width: 88%;
    min-height: 0;
    padding: 0.72rem 0.92rem 0.78rem;
    border: 0;
    border-radius: 0.35rem;
    background: var(--film-dialogue-bg);
    box-shadow: 0 0.45rem 1.25rem rgba(21, 40, 28, 0.18);
    color: var(--film-dialogue-ink);
    backdrop-filter: blur(0.25rem);
    opacity: var(--dialogue-opacity, 0);
    transform: translate3d(0, var(--dialogue-y, 1.2rem), 0);
    transition: opacity 180ms linear, transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .grandma-film__dialogue-line--outgoing {
    left: auto;
    right: 0;
    border-color: transparent;
    background: var(--film-dialogue-outgoing-bg);
    color: var(--film-dialogue-outgoing-ink);
    text-align: left;
  }

  .grandma-film__dialogue-name {
    display: block;
    margin-bottom: 0.26rem;
    color: var(--film-dialogue-name);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.1em;
  }

  .grandma-film__dialogue-line p {
    margin: 0;
    font-size: clamp(0.94rem, 1.35vw, 1.08rem);
    line-height: 1.65;
  }

  .grandma-film__dialogue-ellipsis {
    position: absolute;
    inset: 3.05rem 0 auto;
    margin: 0;
    color: #f7fff5;
    font-size: clamp(2rem, 4vw, 3.5rem);
    font-weight: 800;
    letter-spacing: 0.16em;
    opacity: var(--dialogue-ellipsis, 0);
    text-align: center;
    text-shadow: 0 0.18rem 0.8rem rgba(27, 55, 34, 0.34);
    transform: translateY(calc((1 - var(--dialogue-ellipsis, 0)) * 0.8rem));
    transition: opacity 220ms ease, transform 220ms ease;
  }

  .grandma-film__quote {
    padding-block: clamp(5rem, 14vw, 13rem);
    text-align: center;
  }

  .grandma-film__quote p {
    margin: 0;
    color: var(--film-warm);
    font-size: clamp(2rem, 5vw, 4.8rem);
    font-weight: 800;
    letter-spacing: -0.05em;
    line-height: 1.1;
  }

  .grandma-film__quote span {
    display: block;
    margin-top: 1.25rem;
    color: var(--film-muted);
    font-size: clamp(0.95rem, 1.7vw, 1.2rem);
  }

  .grandma-film__paragraph-break {
    margin-block: 3.5rem !important;
    color: var(--film-warm);
    font-size: clamp(1.3rem, 2.5vw, 2rem);
    font-weight: 750;
  }

  .grandma-film__prose blockquote {
    margin: 3rem 0;
    padding: 1.25rem 0 1.25rem 1.5rem;
    border-left: 1px solid var(--film-warm);
    color: var(--film-warm);
    font-size: clamp(1.25rem, 2.4vw, 1.8rem);
    line-height: 1.65;
  }

  .grandma-film__line-emphasis {
    margin-block: 2rem !important;
    color: inherit;
    font-size: clamp(1.35rem, 2.8vw, 2.2rem);
    font-weight: 750;
    letter-spacing: -0.025em;
    line-height: 1.45;
  }

  .grandma-film__fear {
    margin-block: 4.5rem !important;
    color: var(--film-warm);
    font-size: clamp(3.3rem, 12vw, 9rem);
    font-weight: 850;
    letter-spacing: -0.08em;
    line-height: 0.92;
  }

  .grandma-film__last-line {
    margin-top: clamp(0.8rem, 1.4vh, 1.4rem) !important;
    color: #f7dca9;
    font-size: clamp(1rem, 2.35vh, 1.6rem) !important;
    font-weight: 750;
    line-height: 1.4 !important;
  }

  [data-film-reveal] {
    opacity: 1;
    transform: none;
    transition: opacity 800ms cubic-bezier(0.16, 1, 0.3, 1), transform 800ms cubic-bezier(0.16, 1, 0.3, 1), filter 800ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  :global(.grandma-film[data-film-ready]) .grandma-film__scene-copy--balcony {
    opacity: var(--balcony-copy-opacity, 1);
    transform: translate3d(0, var(--balcony-copy-y, 0rem), 0);
  }

  :global(.grandma-film[data-film-ready] [data-film-reveal]:not(.is-visible)) {
    opacity: 0;
    filter: blur(0.35rem);
    transform: translate3d(0, 1.1rem, 0);
  }

  @media (max-width: 767px) {
    .grandma-film__interactive {
      display: none !important;
    }

    .grandma-film__plain-content {
      display: block !important;
    }

    .grandma-film__desktop-note {
      align-items: flex-start;
      gap: 0.7rem;
      width: calc(100% - 1rem);
      padding: 0.85rem 0.95rem;
    }

    .grandma-film__desktop-note-label {
      padding-top: 0.12rem;
    }

    .grandma-film__scene {
      min-height: 135vh;
      margin-inline: 0;
    }

    .grandma-film__scene--balcony {
      min-height: 920vh;
    }

    .grandma-film__scene--desk {
      min-height: 260vh;
    }

    .grandma-film__scene--ending {
      min-height: 215vh;
    }

    .grandma-film__sticky {
      top: max(4.2rem, calc(4.2rem + (100vh - 4.2rem - max(69vh, 31rem)) / 2));
      height: 69vh;
      min-height: 31rem;
    }

    .grandma-film__scroll-hint {
      display: none;
    }

    .grandma-film__image {
      object-position: 58% center;
    }

    .grandma-film__scene-copy,
    .grandma-film__ending-copy {
      padding: 1.2rem;
    }

    .grandma-film__scene-copy {
      right: 0;
      bottom: 1.2rem;
      max-width: none;
    }

    .grandma-film__ending-copy h2 {
      font-size: clamp(1.8rem, 7.5vw, 2.8rem);
    }

    .grandma-film__prose,
    .grandma-film__chapter,
    .grandma-film__quote {
      width: 100%;
    }

    .grandma-film__prose--opening,
    .grandma-film__chapter,
    .grandma-film__quote {
      padding-inline: 0;
    }

    .grandma-film__date-track {
      grid-template-columns: 1fr;
      gap: 1.2rem;
      padding-left: 1.1rem;
      border-top: 0;
      border-left: 1px solid var(--film-line);
    }

    .grandma-film__date-track::before {
      top: 0;
      left: -0.22rem;
    }

    .grandma-film__dialogue {
      top: clamp(0.65rem, 2.5vh, 1.25rem);
      left: 0.9rem;
      right: 0.9rem;
      width: auto;
      min-height: 10.2rem;
    }

    .grandma-film__dialogue-line {
      min-height: 4.2rem;
      padding: 0.75rem 0.8rem 0.85rem;
    }

    .grandma-film__quote p {
      font-size: clamp(2rem, 10vw, 3.4rem);
    }

    .grandma-film__chapter h2[id],
    .grandma-film__toc-heading[id] {
      scroll-margin-top: 5.75rem;
    }
  }

  .grandma-film__mode-feedback {
    margin: 0.1rem 0 0;
    color: var(--film-warm);
    font-size: 0.82rem;
    line-height: 1.55;
  }

  @media (prefers-reduced-motion: reduce) {
    .grandma-film__scroll-hint {
      display: none;
    }

    [data-film-reveal],
    :global(.grandma-film[data-film-ready] [data-film-reveal]:not(.is-visible)) {
      opacity: 1 !important;
      filter: none !important;
      transform: none !important;
      transition: none !important;
    }

    .grandma-film__dialogue {
      position: absolute;
    }

    .grandma-film__dialogue-line {
      position: static;
      min-height: 0;
      margin-top: 0.6rem;
      opacity: 1 !important;
      transform: none !important;
      transition: none !important;
    }

    .grandma-film__dialogue-ellipsis {
      position: static;
      opacity: 1 !important;
      transform: none !important;
    }

    .grandma-film__ending-copy > [data-ending-copy] {
      position: static;
      width: auto;
      margin: 0.6rem 0;
      opacity: 1 !important;
      filter: none !important;
      transform: none !important;
      transition: none !important;
    }
  }

  .grandma-film--plain .grandma-film__image-pair,
  .grandma-film--plain .grandma-film__scroll-hint,
  .grandma-film--plain .grandma-film__sun-haze,
  .grandma-film--plain .grandma-film__light-sweep,
  .grandma-film--plain .grandma-film__hair-glow,
  .grandma-film--plain .grandma-film__desk-glow,
  .grandma-film--plain .grandma-film__vignette {
    display: none;
  }

  .grandma-film--plain [data-film-reveal] {
    opacity: 1 !important;
    filter: none !important;
    transform: none !important;
    transition: none !important;
  }

  .grandma-film--plain .grandma-film__scene {
    min-height: 0;
    margin-block: 0;
  }

  .grandma-film--plain .grandma-film__prose--opening {
    padding-top: 2rem;
    padding-bottom: 3rem;
  }

  .grandma-film--plain .grandma-film__scene--desk,
  .grandma-film--plain .grandma-film__scene--ending {
    color: var(--film-ink);
  }

  .grandma-film--plain .grandma-film__sticky {
    position: static;
    height: auto;
    min-height: 0;
  }

  .grandma-film--plain .grandma-film__scene-copy,
  .grandma-film--plain .grandma-film__ending-copy {
    position: static;
    display: block;
    width: min(100%, 65ch);
    max-width: 65ch;
    margin: 0 auto;
    padding: 1rem 0;
    overflow: visible;
    color: var(--film-ink);
    text-shadow: none;
    opacity: 1 !important;
    transform: none !important;
    filter: none !important;
    transition: none !important;
  }

  .grandma-film--plain .grandma-film__scene-copy p,
  .grandma-film--plain .grandma-film__ending-copy p {
    margin: 1.2rem 0;
    font-size: 1rem;
    line-height: 1.95;
  }

  .grandma-film--plain .grandma-film__scene-copy--hair-transition {
    pointer-events: auto;
  }

  .grandma-film--plain .grandma-film__dialogue {
    position: static;
    width: min(100%, 65ch);
    min-height: 0;
    margin: 1rem auto 2rem;
    color: var(--film-ink);
    text-shadow: none;
  }

  .grandma-film--plain .grandma-film__dialogue-notice {
    position: static;
    display: block;
    margin: 0 0 1rem;
    padding: 0;
    background: transparent;
    box-shadow: none;
    color: var(--film-muted);
    font-size: 0.78rem;
  }

  .grandma-film--plain .grandma-film__dialogue-line {
    position: static;
    display: grid;
    grid-template-columns: 3rem minmax(0, 1fr);
    gap: 0.8rem;
    width: auto;
    max-width: none;
    min-height: 0;
    margin: 0;
    padding: 0.8rem 0;
    border: 0;
    border-bottom: 1px solid var(--film-line);
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    color: var(--film-ink);
    opacity: 1 !important;
    transform: none !important;
    filter: none !important;
    transition: none !important;
  }

  .grandma-film--plain .grandma-film__dialogue-line--outgoing {
    background: transparent;
    text-align: left;
  }

  .grandma-film--plain .grandma-film__dialogue-name {
    margin: 0;
    padding-top: 0.1rem;
    color: var(--film-blue);
    font-size: 0.78rem;
  }

  .grandma-film--plain .grandma-film__dialogue-line p {
    margin: 0;
    font-size: 1rem;
    line-height: 1.75;
  }

  .grandma-film--plain .grandma-film__toc-heading {
    position: static;
    width: min(100%, 65ch);
    height: auto;
    margin: clamp(2.5rem, 6vw, 4.5rem) auto 1.5rem;
    padding: 0;
    overflow: visible;
    border: 0;
    clip: auto;
    color: var(--film-ink);
    font-size: clamp(1.8rem, 4vw, 3.8rem);
    font-weight: 800;
    letter-spacing: -0.045em;
    line-height: 1.12;
    white-space: normal;
  }

  .grandma-film--plain .grandma-film__ending-copy > [data-ending-copy] {
    position: static;
    width: auto;
    margin: 1.2rem 0;
    opacity: 1 !important;
    filter: none !important;
    transform: none !important;
    transition: none !important;
  }

  .grandma-film--plain .grandma-film__ending-copy h2 {
    color: var(--film-warm);
  }

  .grandma-film--plain .grandma-film__last-line {
    color: var(--film-warm);
  }
</style>

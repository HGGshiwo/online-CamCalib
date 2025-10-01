function createTrigger(fps: number) {
    let lastTime = 0;
    const interval = 1000 / fps;
    return function () {
      const now = performance.now();
      if (now - lastTime >= interval) {
        lastTime = now;
        return true;
      }
      return false;
    };
}

export { createTrigger };
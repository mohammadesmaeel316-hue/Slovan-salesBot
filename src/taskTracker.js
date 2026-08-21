"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");

const taskStorage = new AsyncLocalStorage();

function trackHandler(handler) {
  return (...args) => {
    const task = Promise.resolve().then(() => handler(...args));
    const tasks = taskStorage.getStore();

    if (tasks) tasks.push(task);
    else task.catch((error) => console.error("Telegram handler failed:", error));

    return task;
  };
}

async function processUpdateAndWait(bot, update) {
  const tasks = [];
  await taskStorage.run(tasks, async () => {
    bot.processUpdate(update);
    await Promise.all(tasks);
  });
}

module.exports = {
  processUpdateAndWait,
  trackHandler,
};

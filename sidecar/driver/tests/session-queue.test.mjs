import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { createSessionQueues } from "../session-queue.mjs";

test("同一会话的命令按入队顺序串行执行", async () => {
  const queues = createSessionQueues();
  const order = [];
  const track = (label, ms) => async () => {
    await delay(ms);
    order.push(label);
  };
  await Promise.all([
    queues.enqueue("s1", track("a", 30)),
    queues.enqueue("s1", track("b", 5)),
    queues.enqueue("s1", track("c", 1)),
  ]);
  assert.deepEqual(order, ["a", "b", "c"], "后入队任务不得先于前序完成前启动");
});

test("replay 场景：send 在慢速 replay 完成后才启动（不双建 Agent 的时序基础）", async () => {
  const queues = createSessionQueues();
  const order = [];
  const slowReplay = async () => {
    await delay(40);
    order.push("replay_done");
  };
  const send = async () => {
    order.push("send_message");
  };
  const replayP = queues.enqueue("s1", slowReplay);
  const sendP = queues.enqueue("s1", send);
  await Promise.all([replayP, sendP]);
  assert.deepEqual(order, ["replay_done", "send_message"]);
});

test("不同会话并行：阻塞的会话不阻塞其他会话", async () => {
  const queues = createSessionQueues();
  const order = [];
  let releaseFirst;
  const gate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const first = queues.enqueue("s1", async () => {
    await gate;
    order.push("s1");
  });
  const second = queues.enqueue("s2", async () => {
    order.push("s2");
  });
  await second;
  assert.deepEqual(order, ["s2"], "s2 不得等待 s1");
  releaseFirst();
  await first;
  assert.deepEqual(order, ["s2", "s1"]);
});

test("前序任务失败不阻塞同会话后续任务", async () => {
  const queues = createSessionQueues();
  const order = [];
  await queues
    .enqueue("s1", async () => {
      order.push("fail");
      throw new Error("boom");
    })
    .catch(() => {});
  await queues.enqueue("s1", async () => {
    order.push("after");
  });
  assert.deepEqual(order, ["fail", "after"]);

  const p1 = queues.enqueue("s1", async () => {
    throw new Error("x");
  });
  const p2 = queues.enqueue("s1", async () => {
    order.push("recovered");
  });
  await p1.catch(() => {});
  await p2;
  assert.ok(order.includes("recovered"), "失败后的下一个任务必须照常执行");
});

test("完成后队列清空，drain 等待全部收束", async () => {
  const queues = createSessionQueues();
  assert.equal(queues.size, 0);
  const tasks = [
    queues.enqueue("a", () => delay(5)),
    queues.enqueue("b", () => delay(5)),
  ];
  assert.equal(queues.size, 2, "在途任务应留在队列跟踪中");
  await queues.drain();
  assert.equal(queues.size, 0, "收束后队列应清空");
  await Promise.all(tasks.map((task) => task.catch(() => {})));
});

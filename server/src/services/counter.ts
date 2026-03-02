import { prisma } from './prisma';

const COUNTER_NAME = 'demo';

export async function getCounter() {
  const counter = await prisma.counter.upsert({
    where: { name: COUNTER_NAME },
    update: {},
    create: { name: COUNTER_NAME, value: 0 },
  });
  return { name: counter.name, value: counter.value };
}

export async function incrementCounter() {
  const counter = await prisma.counter.upsert({
    where: { name: COUNTER_NAME },
    update: { value: { increment: 1 } },
    create: { name: COUNTER_NAME, value: 1 },
  });
  return { name: counter.name, value: counter.value };
}

export async function decrementCounter() {
  const counter = await prisma.counter.upsert({
    where: { name: COUNTER_NAME },
    update: { value: { decrement: 1 } },
    create: { name: COUNTER_NAME, value: -1 },
  });
  return { name: counter.name, value: counter.value };
}

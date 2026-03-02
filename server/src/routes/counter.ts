import { Router } from 'express';
import { getCounter, incrementCounter, decrementCounter } from '../services/counter';

export const counterRouter = Router();

counterRouter.get('/counter', async (_req, res, next) => {
  try {
    const counter = await getCounter();
    res.json(counter);
  } catch (err) {
    next(err);
  }
});

counterRouter.post('/counter/increment', async (_req, res, next) => {
  try {
    const counter = await incrementCounter();
    res.json(counter);
  } catch (err) {
    next(err);
  }
});

counterRouter.post('/counter/decrement', async (_req, res, next) => {
  try {
    const counter = await decrementCounter();
    res.json(counter);
  } catch (err) {
    next(err);
  }
});

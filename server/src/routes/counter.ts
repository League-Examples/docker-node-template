import { Router } from 'express';

export const counterRouter = Router();

counterRouter.get('/counter', async (req, res, next) => {
  try {
    const counter = await req.services.counter.get();
    res.json(counter);
  } catch (err) {
    next(err);
  }
});

counterRouter.post('/counter/increment', async (req, res, next) => {
  try {
    const counter = await req.services.counter.increment();
    res.json(counter);
  } catch (err) {
    next(err);
  }
});

counterRouter.post('/counter/decrement', async (req, res, next) => {
  try {
    const counter = await req.services.counter.decrement();
    res.json(counter);
  } catch (err) {
    next(err);
  }
});

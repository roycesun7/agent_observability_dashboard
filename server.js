/**
 * Simple API server to serve OpenClaw session data.
 * Reads from the JSONL transcript files.
 */

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const app = express();
app.use(cors());
app.use(express.json());

const SESSIONS_DIR = process.env.SESSIONS_DIR || 
  path.join(process.env.HOME, '.openclaw/agents/main/sessions');

/**
 * Parse a JSONL file and extract session info
 */
async function parseSessionFile(filePath) {
  const stats = fs.statSync(filePath);
  const sessionId = path.basename(filePath, '.jsonl');
  
  const lines = [];
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (line.trim()) {
      try {
        lines.push(JSON.parse(line));
      } catch (e) {
        // Skip invalid JSON
      }
    }
  }

  // Extract session metadata from first line
  const sessionLine = lines.find(l => l.type === 'session');
  const sessionKey = sessionLine?.id ? `agent:main:${sessionLine.id}` : sessionId;
  
  // Extract messages (type: message)
  const messagelines = lines.filter(l => l.type === 'message' && l.message);
  
  // Calculate tokens and cost from messages
  let totalTokens = 0;
  let totalCost = 0;
  let model = 'unknown';
  let lastStatus = 'idle';
  
  for (const line of messagelines) {
    const msg = line.message;
    if (msg?.usage) {
      totalTokens += msg.usage.totalTokens || 0;
      if (msg.usage.cost?.total) {
        totalCost += msg.usage.cost.total;
      }
    }
    if (msg?.model) {
      model = msg.model;
    }
    if (msg?.stopReason) {
      lastStatus = msg.stopReason === 'toolUse' ? 'running' : 'completed';
    }
  }

  // Check for labels in spawn events
  let label = 'Main';
  const spawnLine = lines.find(l => l.type === 'custom' && l.data?.label);
  if (spawnLine?.data?.label) {
    label = spawnLine.data.label;
  } else if (sessionKey.includes('subagent')) {
    label = 'Sub-agent';
  }

  // Check for model in model-snapshot events
  const modelLine = lines.find(l => l.customType === 'model-snapshot');
  if (modelLine?.data?.modelId) {
    model = modelLine.data.modelId;
  }

  // Determine status
  let status = 'idle';
  if (totalTokens > 0) {
    status = lastStatus;
  }

  return {
    sessionId,
    sessionKey,
    label,
    model,
    totalTokens,
    totalCost,
    status,
    messageCount: messagelines.length,
    lastUpdated: stats.mtime.toISOString(),
    createdAt: stats.birthtime.toISOString(),
    filePath,
  };
}

/**
 * Get all sessions
 */
app.get('/api/sessions', async (req, res) => {
  try {
    const activeMinutes = parseInt(req.query.activeMinutes) || 60;
    const cutoff = Date.now() - (activeMinutes * 60 * 1000);
    
    const files = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.jsonl'));
    
    const sessions = [];
    
    for (const file of files) {
      const filePath = path.join(SESSIONS_DIR, file);
      const stats = fs.statSync(filePath);
      
      // Filter by active time
      if (stats.mtime.getTime() < cutoff) continue;
      
      try {
        const session = await parseSessionFile(filePath);
        sessions.push(session);
      } catch (e) {
        console.error(`Error parsing ${file}:`, e.message);
      }
    }

    // Sort by last updated
    sessions.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));

    res.json({
      count: sessions.length,
      sessions,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get session details
 */
app.get('/api/sessions/:sessionId', async (req, res) => {
  try {
    const filePath = path.join(SESSIONS_DIR, `${req.params.sessionId}.jsonl`);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const session = await parseSessionFile(filePath);
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get historical stats
 */
app.get('/api/stats', async (req, res) => {
  try {
    const files = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.jsonl'));
    
    let totalTokens = 0;
    let totalCost = 0;
    let totalSessions = files.length;
    let activeToday = 0;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (const file of files) {
      const filePath = path.join(SESSIONS_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (stats.mtime >= today) {
        activeToday++;
      }
      
      try {
        const session = await parseSessionFile(filePath);
        totalTokens += session.totalTokens;
        totalCost += session.totalCost;
      } catch (e) {
        // Skip
      }
    }

    res.json({
      totalSessions,
      activeToday,
      totalTokens,
      totalCost,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🔭 Agent Observatory API running on http://localhost:${PORT}`);
  console.log(`📁 Sessions directory: ${SESSIONS_DIR}`);
});

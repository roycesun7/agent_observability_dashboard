/**
 * Simple API server to serve OpenClaw session data.
 * Reads from the JSONL transcript files (including deleted/archived).
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
 * Extract session ID from filename (handles .deleted suffix)
 */
function extractSessionId(filename) {
  // Handle: abc123.jsonl or abc123.jsonl.deleted.2026-02-11...
  const match = filename.match(/^([a-f0-9-]+)\.jsonl/);
  return match ? match[1] : filename;
}

/**
 * Parse a JSONL file and extract session info
 */
async function parseSessionFile(filePath) {
  const stats = fs.statSync(filePath);
  const filename = path.basename(filePath);
  const sessionId = extractSessionId(filename);
  const isDeleted = filename.includes('.deleted');
  
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

  // Check for labels in spawn events or task field
  let label = 'Main';
  const spawnLine = lines.find(l => l.type === 'custom' && l.data?.label);
  if (spawnLine?.data?.label) {
    label = spawnLine.data.label;
  } else if (sessionKey.includes('subagent')) {
    // Try to find task description
    const taskLine = lines.find(l => l.type === 'message' && l.message?.content?.[0]?.text?.includes('Your Task'));
    if (taskLine) {
      const text = taskLine.message.content[0].text;
      const taskMatch = text.match(/label['":\s]+([^'"}\n]+)/i);
      label = taskMatch ? taskMatch[1].trim() : 'Sub-agent';
    } else {
      label = 'Sub-agent';
    }
  }

  // Check for model in model-snapshot events
  const modelLine = lines.find(l => l.customType === 'model-snapshot');
  if (modelLine?.data?.modelId) {
    model = modelLine.data.modelId;
  }

  // Determine status
  let status = isDeleted ? 'archived' : 'idle';
  if (totalTokens > 0 && !isDeleted) {
    status = lastStatus;
  } else if (isDeleted) {
    status = 'archived';
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
    isDeleted,
  };
}

/**
 * Get all sessions
 */
app.get('/api/sessions', async (req, res) => {
  try {
    const activeMinutes = parseInt(req.query.activeMinutes) || 1440; // Default 24h
    const includeArchived = req.query.includeArchived !== 'false'; // Default true
    const cutoff = Date.now() - (activeMinutes * 60 * 1000);
    
    const files = fs.readdirSync(SESSIONS_DIR)
      .filter(f => {
        if (f.endsWith('.jsonl')) return true;
        if (includeArchived && f.includes('.jsonl.deleted')) return true;
        return false;
      })
      .filter(f => !f.endsWith('.lock') && !f.endsWith('.json'));
    
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
    // Try active file first, then deleted
    let filePath = path.join(SESSIONS_DIR, `${req.params.sessionId}.jsonl`);
    
    if (!fs.existsSync(filePath)) {
      // Look for deleted version
      const files = fs.readdirSync(SESSIONS_DIR);
      const deletedFile = files.find(f => f.startsWith(`${req.params.sessionId}.jsonl.deleted`));
      if (deletedFile) {
        filePath = path.join(SESSIONS_DIR, deletedFile);
      } else {
        return res.status(404).json({ error: 'Session not found' });
      }
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
      .filter(f => f.includes('.jsonl') && !f.endsWith('.lock') && !f.endsWith('.json'));
    
    let totalTokens = 0;
    let totalCost = 0;
    let totalSessions = 0;
    let activeToday = 0;
    let archivedCount = 0;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (const file of files) {
      const filePath = path.join(SESSIONS_DIR, file);
      const stats = fs.statSync(filePath);
      const isDeleted = file.includes('.deleted');
      
      totalSessions++;
      if (isDeleted) archivedCount++;
      
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
      archivedCount,
      activeSessions: totalSessions - archivedCount,
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

import { WikiBlock, BlockType, MermaidMetadata } from '../types';
import { buildTree } from './treeBuilder';

export const parseSingleBlockUpdate = (content: string): { content: string; metadata?: MermaidMetadata } => {
  // Check for embedded JSON block with sourceMapping
  const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  
  if (jsonBlockMatch) {
    try {
        const jsonBody = jsonBlockMatch[1];
        const parsed = JSON.parse(jsonBody);
        if (parsed.sourceMapping) {
            return {
                content: content.replace(jsonBlockMatch[0], '').trim(),
                metadata: { sourceMapping: parsed.sourceMapping }
            };
        }
    } catch (e) {
        // ignore invalid json or unexpected format
    }
  }
  return { content };
};

export const parseMarkdownToBlocks = (markdown: string, buildTreeStructure = true): WikiBlock[] => {
  const lines = markdown.split('\n');
  const blocks: WikiBlock[] = [];
  let currentIdCounter = 0;
  const generateId = () => `block-${Date.now()}-${currentIdCounter++}`;

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Skip empty lines between blocks
    if (trimmedLine === '') {
      i++;
      continue;
    }

    // 1. Code Blocks (including Mermaid)
    if (trimmedLine.startsWith('```')) {
      const lang = trimmedLine.replace('```', '').trim();
      const isMermaid = lang === 'mermaid';
      const codeLines: string[] = [];
      
      codeLines.push(line); // Start fence
      i++;
      
      while (i < lines.length) {
        const codeLine = lines[i];
        codeLines.push(codeLine);
        if (codeLine.trim().startsWith('```')) {
          i++;
          break;
        }
        i++;
      }

      const fullContent = codeLines.join('\n');
      const contentPayload = isMermaid 
        ? fullContent.replace(/```mermaid\n|```/g, '').trim() 
        : fullContent.replace(/^```.*\n/, '').replace(/```$/, '').trim();

      const blockId = generateId();
      const block: WikiBlock = {
        id: blockId,
        type: isMermaid ? 'mermaid' : 'code',
        content: isMermaid ? contentPayload : fullContent
      };

      // **Mermaid Metadata Parsing Logic**
      // Check if the *next* block is a JSON block containing sourceMapping
      if (isMermaid) {
          let nextI = i;
          // Skip empty lines
          while (nextI < lines.length && lines[nextI].trim() === '') {
              nextI++;
          }
          
          if (nextI < lines.length && lines[nextI].trim().startsWith('```json')) {
              // Potential mapping block
              const jsonLines: string[] = [];
              let j = nextI + 1;
              let foundEnd = false;
              while (j < lines.length) {
                  if (lines[j].trim().startsWith('```')) {
                      foundEnd = true;
                      break;
                  }
                  jsonLines.push(lines[j]);
                  j++;
              }
              
              if (foundEnd) {
                  try {
                      const jsonStr = jsonLines.join('\n');
                      const data = JSON.parse(jsonStr);
                      if (data.sourceMapping) {
                          block.metadata = { sourceMapping: data.sourceMapping };
                          // Advance main iterator `i` past this JSON block so it's not rendered as code
                          i = j + 1; 
                      }
                  } catch (e) {
                      console.warn("Failed to parse source mapping JSON", e);
                  }
              }
          }
      }

      blocks.push(block);
      continue;
    }

    // 2. Headings
    if (trimmedLine.startsWith('#')) {
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      blocks.push({
        id: generateId(),
        type: 'heading',
        level: match ? match[1].length : 1,
        content: match ? match[2] : trimmedLine.replace(/^#+\s*/, '')
      });
      i++;
      continue;
    }

    // 3. Lists (Aggregated)
    const isListStart = /^(\*|-|\+|\d+\.)\s/.test(trimmedLine);
    if (isListStart) {
      const listLines: string[] = [];
      while (i < lines.length) {
        const currentLine = lines[i];
        const currentTrimmed = currentLine.trim();
        const isItem = /^(\*|-|\+|\d+\.)\s/.test(currentTrimmed);
        const isBlockStart = currentTrimmed.startsWith('#') || currentTrimmed.startsWith('```') || currentTrimmed.startsWith('|');
        if (currentTrimmed === '' || isItem || (!isBlockStart)) {
           listLines.push(currentLine);
           i++;
        } else {
           break;
        }
      }
      blocks.push({
        id: generateId(),
        type: 'list',
        content: listLines.join('\n')
      });
      continue;
    }

    // 4. Tables (Aggregated)
    if (trimmedLine.startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length) {
        const currentLine = lines[i];
        if (currentLine.trim().startsWith('|')) {
          tableLines.push(currentLine);
          i++;
        } else {
          break;
        }
      }
      blocks.push({
        id: generateId(),
        type: 'table',
        content: tableLines.join('\n')
      });
      continue;
    }

    // 5. Paragraphs
    const paraLines: string[] = [];
    while (i < lines.length) {
      const currentLine = lines[i];
      const currentTrimmed = currentLine.trim();
      if (currentTrimmed === '') { i++; break; }
      if (currentTrimmed.startsWith('```') || 
          currentTrimmed.startsWith('#') || 
          /^(\*|-|\+|\d+\.)\s/.test(currentTrimmed) || 
          currentTrimmed.startsWith('|')) {
        break;
      }
      paraLines.push(currentLine);
      i++;
    }
    
    if (paraLines.length > 0) {
      blocks.push({
        id: generateId(),
        type: 'paragraph',
        content: paraLines.join('\n')
      });
    }
  }

  // Build tree structure if enabled
  if (buildTreeStructure) {
    return buildTree(blocks);
  }

  return blocks;
};
import { ClozeCrafter } from "clozecraft";
import { CardType } from "src/question";
import { TopicPathList } from "src/topic-path";
import { Card } from "src/card";
import { frontmatterTagPseudoLineNum } from "src/file";
import { RepetitionPhase } from "src/algorithms/base/repetition-item";
import { RepItemScheduleInfoOsr } from "src/algorithms/osr/rep-item-schedule-info-osr";

export let debugParser = false;

export interface ParserOptions {
    singleLineCardSeparator: string;
    singleLineReversedCardSeparator: string;
    multilineCardSeparator: string;
    multilineReversedCardSeparator: string;
    multilineCardEndMarker: string;
    clozePatterns: string[];
    headingAsBasic: boolean;
}

export function setDebugParser(value: boolean) {
    debugParser = value;
}

export class ParsedQuestionInfo {
    cardType: CardType;
    text: string;

    // Line numbers start at 0
    firstLineNum: number;
    lastLineNum: number;

    questionType: CardType | null = null;
    topicPathList: TopicPathList | null = null;
    cards: Card[] = [];

    constructor(cardType: CardType, text: string, firstLineNum: number, lastLineNum: number) {
        this.cardType = cardType;
        this.text = text;
        this.firstLineNum = firstLineNum;
        this.lastLineNum = lastLineNum;
    }

    isQuestionLineNum(lineNum: number): boolean {
        return lineNum >= this.firstLineNum && lineNum <= this.lastLineNum;
    }
}

function markerInsideCodeBlock(text: string, marker: string, markerIndex: number): boolean {
    let goingBack = markerIndex - 1,
        goingForward = markerIndex + marker.length;
    let backTicksBefore = 0,
        backTicksAfter = 0;

    while (goingBack >= 0) {
        if (text[goingBack] === "`") backTicksBefore++;
        goingBack--;
    }

    while (goingForward < text.length) {
        if (text[goingForward] === "`") backTicksAfter++;
        goingForward++;
    }

    // If there's an odd number of backticks before and after,
    //  the marker is inside an inline code block
    return backTicksBefore % 2 === 1 && backTicksAfter % 2 === 1;
}

function hasInlineMarker(text: string, marker: string): boolean {
    // No marker provided
    if (marker.length == 0) return false;

    // Check if the marker is in the text
    const markerIdx = text.indexOf(marker);
    if (markerIdx === -1) return false;

    // Check if it's inside an inline code block
    return !markerInsideCodeBlock(text, marker, markerIdx);
}

/**
 * Returns flashcards found in `text`
 *
 * It is best that the text does not contain frontmatter, see extractFrontmatter for reasoning
 *
 * @param text - The text to extract flashcards from
 * @param ParserOptions - Parser options
 * @returns An array of parsed question information
 */
export function parse(text: string, options: ParserOptions): ParsedQuestionInfo[] {
    if (debugParser) {
        console.log("Text to parse:\n<<<" + text + ">>>");
    }

    // Sort inline separators by length, longest first
    const inlineSeparators = [
        { separator: options.singleLineCardSeparator, type: CardType.SingleLineBasic },
        { separator: options.singleLineReversedCardSeparator, type: CardType.SingleLineReversed },
    ];
    inlineSeparators.sort((a, b) => b.separator.length - a.separator.length);

    const cards: ParsedQuestionInfo[] = [];
    let cardText = "";
    let cardType: CardType | null = null;
    let firstLineNo = 0,
        lastLineNo = 0;

    const clozecrafter = new ClozeCrafter(options.clozePatterns);
    const lines: string[] = text.replaceAll("\r\n", "\n").split("\n");
    for (let i = 0; i < lines.length; i++) {
        const currentLine = lines[i],
            currentTrimmed = lines[i].trim();

        // Skip everything in HTML comments
        if (currentLine.startsWith("<!--") && !currentLine.startsWith("<!--SR:")) {
            while (i + 1 < lines.length && !currentLine.includes("-->")) i++;
            i++;
            continue;
        }

        // Have we reached the end of a card?
        const isEmptyLine = currentTrimmed.length == 0;
        const hasMultilineCardEndMarker =
            options.multilineCardEndMarker && currentTrimmed == options.multilineCardEndMarker;
        if (
            // We've probably reached the end of a card
            (isEmptyLine && !options.multilineCardEndMarker) ||
            // Empty line & we're not picking up any card
            (isEmptyLine && cardType == null) ||
            // We've reached the end of a multi line card &
            //  we're using custom end markers
            hasMultilineCardEndMarker
        ) {
            if (cardType) {
                // Create a new card
                lastLineNo = i - 1;
                cards.push(
                    new ParsedQuestionInfo(cardType, cardText.trimEnd(), firstLineNo, lastLineNo),
                );
                cardType = null;
            }

            cardText = "";
            firstLineNo = i + 1;
            continue;
        }

        // Update card text
        if (cardText.length > 0) {
            cardText += "\n";
        }
        cardText += currentLine.trimEnd();

        // Pick up inline cards
        for (const { separator, type } of inlineSeparators) {
            if (hasInlineMarker(currentLine, separator)) {
                cardType = type;
                break;
            }
        }

        if (cardType == CardType.SingleLineBasic || cardType == CardType.SingleLineReversed) {
            cardText = currentLine;
            firstLineNo = i;

            // Pick up scheduling information if present
            if (i + 1 < lines.length && lines[i + 1].startsWith("<!--SR:")) {
                cardText += "\n" + lines[i + 1];
                i++;
            }

            lastLineNo = i;
            cards.push(new ParsedQuestionInfo(cardType, cardText, firstLineNo, lastLineNo));

            cardType = null;
            cardText = "";
        } else if (currentTrimmed === options.multilineCardSeparator) {
            // Ignore card if the front of the card is empty
            if (cardText.length > 1) {
                // Pick up multiline basic cards
                cardType = CardType.MultiLineBasic;
            }
        } else if (currentTrimmed === options.multilineReversedCardSeparator) {
            // Ignore card if the front of the card is empty
            if (cardText.length > 1) {
                // Pick up multiline basic cards
                cardType = CardType.MultiLineReversed;
            }
        } else if (currentLine.startsWith("```") || currentLine.startsWith("~~~")) {
            // Pick up codeblocks
            const codeBlockClose = currentLine.match(/`+|~+/)[0];
            while (i + 1 < lines.length && !lines[i + 1].startsWith(codeBlockClose)) {
                i++;
                cardText += "\n" + lines[i];
            }
            cardText += "\n" + codeBlockClose;
            i++;
        } else if (cardType === null && clozecrafter.isClozeNote(currentLine)) {
            // Pick up cloze cards
            cardType = CardType.Cloze;
        } else if (options.headingAsBasic && 
            (currentLine.trim().startsWith('#') || /^\d+$/.test(currentLine.trim())) && 
            !currentLine.trim().includes('-') && // Виключаємо теги типу #flashcards-tts-de
            !currentLine.trim().match(/^#[a-zA-Z0-9_-]+$/)) { // Виключаємо прості теги типу #tag
            
            // Pick up heading as basic card if enabled
            cardType = CardType.HeaderBasic;
            firstLineNo = i;

            // Get content under the heading until next heading
            let nextLine = i + 1;
            let content = "";
            let foundFirstSeparator = false;
            let foundSecondSeparator = false;
            let separatorLine = "";
            let contentLines = [];
            let hasScheduleInfo = false;

            while (nextLine < lines.length) {
                const line = lines[nextLine];
                const trimmedLine = line.trim();
                
                // Break if we find next heading or question mark (for other card types)
                if (trimmedLine.startsWith('#') || trimmedLine === '?') break;
                
                // Handle -- -- separators
                if (trimmedLine === "-- --") {
                    if (!foundFirstSeparator) {
                        foundFirstSeparator = true;
                        separatorLine = line;
                        contentLines = []; // Reset content lines after first separator
                    } else {
                        foundSecondSeparator = true;
                        // Include SR scheduling info if present
                        let nextLineIdx = nextLine + 1;
                        while (nextLineIdx < lines.length) {
                            const nextLineContent = lines[nextLineIdx].trim();
                            if (nextLineContent.startsWith('<!--SR:')) {
                                hasScheduleInfo = true;
                                contentLines.push(lines[nextLineIdx]);
                                nextLineIdx++;
                            } else if (nextLineContent === '') {
                                nextLineIdx++;
                            } else {
                                break;
                            }
                        }
                        nextLine = nextLineIdx - 1;
                        break;
                    }
                    nextLine++;
                    continue;
                }
                
                // Collect content between separators
                if (foundFirstSeparator && !foundSecondSeparator) {
                    contentLines.push(line);
                }
                
                nextLine++;
            }

            // Якщо знайдено обидва роздільники
            if (foundFirstSeparator && foundSecondSeparator) {
                // Extract heading text without # if it exists
                const headingText = currentLine.trim().startsWith('#') 
                    ? currentLine.replace(/^#+\s+/, "").trim()
                    : currentLine.trim();
                
                // Clean up content - remove leading/trailing empty lines but preserve internal formatting
                while (contentLines.length > 0 && contentLines[0].trim() === '') contentLines.shift();
                while (contentLines.length > 0 && contentLines[contentLines.length - 1].trim() === '') contentLines.pop();
                
                // Format content based on whether it has empty lines
                let formattedContent;
                if (contentLines.some(line => line.trim() === '')) {
                    // If there are empty lines in content, preserve them and add extra empty lines
                    contentLines.unshift('');
                    contentLines.push('');
                    formattedContent = contentLines.join('\n');
                } else {
                    // If no empty lines, just join content lines
                    formattedContent = contentLines.join('\n');
                }
                
                // Форматуємо текст картки
                cardText = `${currentLine}\n${separatorLine}\n${formattedContent}\n${separatorLine}`;
                if (hasScheduleInfo) {
                    cardText += '\n' + contentLines[contentLines.length - 1];
                }
                lastLineNo = nextLine;
                
                // Create a new ParsedQuestionInfo with the card data
                const parsedInfo = new ParsedQuestionInfo(cardType, cardText, firstLineNo, lastLineNo);
                parsedInfo.questionType = CardType.HeaderBasic;
                
                // Create a Card object for this header-based flashcard
                const card = new Card({
                    cardIdx: 0,
                    front: headingText,
                    back: formattedContent,
                    repetitionPhase: RepetitionPhase.New
                });
                
                // Check if there's schedule info in the content
                const scheduleMatch = formattedContent.match(/<!--SR:(.+?)-->/);
                if (scheduleMatch) {
                    const scheduleInfo = scheduleMatch[1];
                    const [dateStr, interval, ease] = scheduleInfo.substring(1).split(',');
                    card.scheduleInfo = RepItemScheduleInfoOsr.fromDueDateStr(dateStr, parseFloat(interval), parseFloat(ease));
                }
                
                parsedInfo.cards = [card];
                cards.push(parsedInfo);
                
                // Reset for next card
                cardType = null;
                cardText = "";
                i = nextLine - 1;
            }
        }
    }

    // Do we have a card left in the queue?
    if (cardType && cardText) {
        lastLineNo = lines.length - 1;
        cards.push(new ParsedQuestionInfo(cardType, cardText.trimEnd(), firstLineNo, lastLineNo));
    }

    if (debugParser) {
        console.log("Parsed cards:\n", cards);
    }

    return cards;
}

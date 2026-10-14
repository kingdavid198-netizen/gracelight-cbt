const OPTION_LABELS = ["A", "B", "C", "D"];

function getQuestionOrder(question, index, optionOrder) {
    const questionId = String(question._id || question.questionId || index);
    let order;

    if (optionOrder instanceof Map) {
        order = optionOrder.get(questionId);
    } else if (Array.isArray(optionOrder)) {
        order = Array.isArray(optionOrder[index]) ? optionOrder[index] : optionOrder;
    } else if (optionOrder && typeof optionOrder === "object") {
        order = optionOrder[questionId];
    }

    if (order && !Array.isArray(order) && Array.isArray(order.order)) {
        order = order.order;
    }
    return Array.isArray(order) && order.length === OPTION_LABELS.length
        ? order
        : OPTION_LABELS;
}

function markAttempt(questions, optionOrder, answers) {
    const answerMap = answers && typeof answers === "object" ? answers : {};
    let score = 0;
    const review = questions.map((question, index) => {
        const order = getQuestionOrder(question, index, optionOrder);
        const questionId = String(question._id || question.questionId || index);
        const options = {};
        OPTION_LABELS.forEach((label, optionIndex) => {
            options[label] = question[`option${order[optionIndex]}`] || "";
        });
        const selected = answerMap[questionId] || "";
        const correctAnswer = OPTION_LABELS[order.indexOf(question.answer)] || "";
        const isCorrect = Boolean(correctAnswer) && selected === correctAnswer;
        if (isCorrect) score++;

        return {
            questionNumber: index + 1,
            question: question.question || "",
            image: question.image || "",
            options,
            selected,
            correctAnswer,
            isCorrect
        };
    });

    return { score, review };
}

module.exports = markAttempt;
